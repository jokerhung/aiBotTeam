"""Versioned agent output. SQLite contains metadata and relative paths only."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import re
import shutil
from pathlib import Path

from .store import new_id, now_ms

KINDS = {"html", "markdown", "image", "post"}
LIMITS = {"html": 2 * 1024**2, "markdown": 500 * 1024, "image": 10 * 1024**2, "post": 150_000}
REF = re.compile(r"^(res_[a-zA-Z0-9]+)@v([1-9][0-9]*)$")
TOKEN = re.compile(r"\{\{resource:([^{}]+)\}\}")
SCHEMA = """
CREATE TABLE IF NOT EXISTS resources (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL,
 owner_bot TEXT, thread_id TEXT, tags TEXT NOT NULL DEFAULT '[]', current_version INTEGER NOT NULL,
 archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS resource_identity ON resources(COALESCE(owner_bot,''),name);
CREATE TABLE IF NOT EXISTS resource_versions (
 resource_id TEXT NOT NULL, version INTEGER NOT NULL, path TEXT NOT NULL, files TEXT NOT NULL,
 mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, status TEXT NOT NULL,
 note TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(resource_id,version));
CREATE TABLE IF NOT EXISTS resource_refs (
 source_id TEXT NOT NULL, source_version INTEGER NOT NULL, target_id TEXT NOT NULL, target_version INTEGER NOT NULL,
 PRIMARY KEY(source_id,source_version,target_id,target_version));
"""


class ResourceError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def reference(rid, version):
    return f"{rid}@v{version}"


def split_ref(value):
    match = REF.fullmatch(str(value))
    if not match:
        raise ResourceError("Use an explicit resource reference: res_id@v1")
    return match[1], int(match[2])


def image_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", "gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    raise ResourceError("Images must be PNG, JPEG, GIF or WebP")


class Resources:
    def __init__(self, store, home, bus):
        self.store, self.root, self.bus = store, Path(home) / "resources", bus
        self.lock = asyncio.Lock()

    @property
    def db(self):
        return self.store.db

    async def open(self):
        self.root.mkdir(parents=True, exist_ok=True)
        await self.db.executescript(SCHEMA)
        await self.db.commit()
        cursor = await self.db.execute("SELECT resource_id,version,path,files FROM resource_versions")
        for rid, version, path, files in await cursor.fetchall():
            try:
                if any(not self.path(value).is_file() for value in [path, *json.loads(files)]):
                    raise ResourceError("missing file")
            except ResourceError:
                logging.getLogger(__name__).warning("Resource %s@v%s has a missing or unsafe content file", rid, version)

    def path(self, relative):
        if not isinstance(relative, str) or "\\" in relative or ":" in relative or relative.startswith("/") or ".." in Path(relative).parts:
            raise ResourceError("Unsafe resource path")
        path = self.root / relative
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise ResourceError("Unsafe resource path")
        # Never follow symlinks in managed storage, including links that currently point inside it.
        if any(part.is_symlink() for part in (path, *path.parents) if part != self.root.parent):
            raise ResourceError("Resource paths cannot contain symlinks")
        return path

    async def get(self, rid):
        cursor = await self.db.execute("SELECT id,kind,name,title,owner_bot,thread_id,tags,current_version,archived,created_at,updated_at FROM resources WHERE id=?", (rid,))
        row = await cursor.fetchone()
        if not row:
            raise ResourceError("Resource not found", 404)
        out = dict(zip(("id", "kind", "name", "title", "owner_bot", "thread_id", "tags", "current_version", "archived", "created_at", "updated_at"), row))
        out["tags"], out["archived"] = json.loads(out["tags"]), bool(out["archived"])
        out.update(version=out["current_version"], ref=reference(rid, out["current_version"]))
        return out

    async def version(self, rid, version=None):
        resource = await self.get(rid)
        version = version if version is not None else resource["current_version"]
        if type(version) is not int or version < 1:
            raise ResourceError("Invalid resource version")
        cursor = await self.db.execute("SELECT path,files,mime,size,sha256,status,note,created_by,created_at FROM resource_versions WHERE resource_id=? AND version=?", (rid, version))
        row = await cursor.fetchone()
        if not row:
            raise ResourceError(f"Resource {reference(rid, version)} is missing", 404)
        out = {**resource, **dict(zip(("path", "files", "mime", "size", "sha256", "status", "note", "created_by", "created_at"), row)), "version": version, "ref": reference(rid, version)}
        out["files"] = json.loads(out["files"])
        out["url"] = f"/api/resources/{rid}/versions/{version}/content"
        out["viewer_url"] = f"#/resources/{rid}/v/{version}"
        out["missing"] = any(not self.path(value).is_file() for value in [out["path"], *out["files"]])
        ref = out["ref"]
        cursor = await self.db.execute("SELECT COUNT(*),MAX(finished_at) FROM routine_runs WHERE status='completed' AND (detail=? OR detail LIKE ?)", (ref, ref + " %"))
        count, latest = await cursor.fetchone()
        out.update(run_count=count, latest_run=latest)
        cursor = await self.db.execute("SELECT COUNT(*) FROM resource_versions WHERE resource_id=?", (rid,))
        out["version_count"] = (await cursor.fetchone())[0]
        return out

    async def resolve(self, args, owner=None):
        if args.get("ref"):
            rid, version = split_ref(args["ref"])
        else:
            rid, version = args.get("id") or args.get("resource_id"), args.get("version") or args.get("resource_version")
            if not rid and args.get("name"):
                cursor = await self.db.execute("SELECT id FROM resources WHERE owner_bot IS ? AND name=?", (owner, args["name"]))
                row = await cursor.fetchone()
                rid = row[0] if row else None
        return await self.version(rid, version)

    async def used_by(self, rid, version=None):
        params = [rid] + ([version] if version is not None else [])
        extra = " AND target_version=?" if version is not None else ""
        cursor = await self.db.execute("SELECT source_id,source_version,target_version FROM resource_refs WHERE target_id=?" + extra, params)
        rows = [{"kind": "resource", "id": source, "version": target, "ref": reference(rid, target), "source_version": source_version, "source_ref": reference(source, source_version)} for source, source_version, target in await cursor.fetchall()]
        cursor = await self.db.execute("PRAGMA table_info(routine_defs)")
        if "resource_id" in {row[1] for row in await cursor.fetchall()}:
            cursor = await self.db.execute("SELECT id,name,resource_version FROM routine_defs WHERE resource_id=?" + (" AND resource_version=?" if version is not None else ""), params)
            rows += [{"kind": "routine", "id": ident, "title": name, "version": number, "ref": reference(rid, number)} for ident, name, number in await cursor.fetchall()]
        return rows

    async def versions(self, rid):
        await self.get(rid)
        cursor = await self.db.execute("SELECT version FROM resource_versions WHERE resource_id=? ORDER BY version DESC", (rid,))
        rows = []
        for number, in await cursor.fetchall():
            item = await self.version(rid, number)
            item["in_use"] = bool(await self.used_by(rid, number))
            await self.add_preview(item)
            rows.append(item)
        return rows

    async def list(self, *, kind=None, status=None, bot=None, query="", limit=50, archived=False):
        where, params = ["archived=?"], [int(archived)]
        for name, value in (("kind", kind), ("owner_bot", bot)):
            if value is not None:
                where.append(f"{name}=?"); params.append(value)
        if query:
            where.append("(title LIKE ? OR name LIKE ? OR tags LIKE ?)")
            params += [f"%{query}%"] * 3
        cursor = await self.db.execute("SELECT id FROM resources WHERE " + " AND ".join(where) + " ORDER BY updated_at DESC", params)
        rows = []
        for rid, in await cursor.fetchall():
            item = await self.version(rid)
            if status and item["status"] != status:
                continue
            item["used_by"] = await self.used_by(rid)
            await self.add_preview(item)
            rows.append(item)
            if len(rows) >= min(50, max(1, limit)):
                break
        return rows

    async def add_preview(self, item):
        if not item["missing"] and item["kind"] in {"post", "markdown", "html"}:
            body = await self.read(item)
            item["preview_text"] = body.get("post", {}).get("text", re.sub(r"<[^>]*>", " ", body.get("content", "")))[:280]
            media = body.get("post", {}).get("media", [])
            if media:
                item["preview_image"] = {**media[0], "ref": reference(media[0]["resource_id"], media[0]["version"])}

    def file_bytes(self, filename, workspace, limit):
        path = Path(str(filename))
        if not workspace or not path.is_absolute() or not path.resolve().is_relative_to(Path(workspace).resolve()):
            raise ResourceError("Choose a file inside the agent workspace")
        if not path.is_file() or path.stat().st_size > limit:
            raise ResourceError("Resource file is missing or exceeds its size limit")
        with path.open("rb") as source:
            data = source.read(limit + 1)
        if len(data) > limit:
            raise ResourceError("Resource exceeds its size limit")
        return data

    async def publish(self, args, *, owner=None, thread=None, workspace=None, person=False, settings=None):
        async with self.lock:
            return await self._publish(args, owner=owner, thread=thread, workspace=workspace, person=person, settings=settings)

    async def _publish(self, args, *, owner=None, thread=None, workspace=None, person=False, settings=None):
        kind, name = args.get("kind"), str(args.get("name") or "")
        if kind not in KINDS or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) or len(name) > 80:
            raise ResourceError("Choose a resource kind and a lowercase hyphenated name (up to 80 characters)")
        title = str(args.get("title") or name)
        tags = args.get("tags") or []
        note = str(args.get("note") or "")
        if len(title) > 200 or len(note) > 1000 or not isinstance(tags, list) or len(tags) > 10 or any(not isinstance(t, str) or len(t) > 50 for t in tags):
            raise ResourceError("Resource metadata is too long")
        if kind == "html" and settings is not None and not settings.allowHtml:
            raise ResourceError("HTML resources are disabled")
        cursor = await self.db.execute("SELECT id FROM resources WHERE owner_bot IS ? AND name=?", (owner, name))
        row = await cursor.fetchone()
        old = await self.get(row[0]) if row else None
        if old and old["kind"] != kind:
            raise ResourceError("A resource's kind cannot change")
        if old and args.get("base_version") is not None and args["base_version"] != old["current_version"]:
            raise ResourceError("Resource changed; read the current version and retry", 409)
        rid, number = (old["id"], old["current_version"] + 1) if old else (new_id("res"), 1)
        refs, extra_files = [], {}
        limits = dict(LIMITS)
        if settings is not None:
            limits.update(html=settings.maxHtmlBytes, markdown=settings.maxMarkdownBytes, image=settings.maxImageBytes)
        if args.get("file") and (args.get("content") is not None or args.get("data") is not None):
            raise ResourceError("Supply content or a file, not both")
        if kind == "post":
            text, platform = args.get("text"), args.get("platform")
            if not isinstance(text, str) or not text.strip() or len(text) > 20000 or not isinstance(platform, str) or not 0 < len(platform) <= 60:
                raise ResourceError("A post needs a platform and 1-20000 characters of text")
            media = []
            images = args.get("images", args.get("media", []))
            if not isinstance(images, list) or len(images) > 20:
                raise ResourceError("A post supports up to 20 images")
            alts = args.get("alts") or []
            if not isinstance(alts, list) or any(not isinstance(alt, str) or len(alt) > 4000 for alt in alts):
                raise ResourceError("Post image descriptions must be a list of text")
            for index, value in enumerate(images):
                alt = str(alts[index]) if index < len(alts) else ""
                if isinstance(value, dict):
                    if not value.get("resource_id") or not value.get("version"):
                        raise ResourceError("Post media requires resource_id and version")
                    image = await self.version(value["resource_id"], value["version"])
                    alt = value.get("alt") or alt
                    if not isinstance(alt, str) or len(alt) > 4000:
                        raise ResourceError("Invalid image description")
                elif isinstance(value, str) and REF.fullmatch(value):
                    image = await self.version(*split_ref(value))
                else:
                    data = self.file_bytes(value, workspace, limits["image"])
                    image_hash = hashlib.sha256(data + json.dumps({"alt": alt}, ensure_ascii=False).encode()).hexdigest()
                    cursor = await self.db.execute("SELECT r.id,v.version FROM resources r JOIN resource_versions v ON r.id=v.resource_id AND r.current_version=v.version WHERE r.kind='image' AND r.archived=0 AND r.owner_bot IS ? AND v.sha256=? LIMIT 1", (owner, image_hash))
                    existing_image = await cursor.fetchone()
                    if existing_image:
                        image = await self.version(*existing_image)
                    else:
                        child_name = name[:45] + f"-image-{index + 1}-" + hashlib.sha256(data).hexdigest()[:8]
                        image = await self._publish({"kind": "image", "name": child_name, "title": f"{title[:170]} image {index+1}", "data": data, "alt": alt}, owner=owner, thread=thread, workspace=workspace, person=person, settings=settings)
                if image["kind"] != "image" or image["missing"]:
                    raise ResourceError("Post media must reference an available image")
                if not alt:
                    alt = (await self.read(image))["alt"]
                media.append({"resource_id": image["id"], "version": image["version"], "alt": alt})
                refs.append((image["id"], image["version"]))
            body = {"platform": platform, "text": text, "hashtags": args.get("hashtags", []), "media": media}
            if not isinstance(body["hashtags"], list) or len(body["hashtags"]) > 100 or any(not isinstance(v, str) or len(v) > 100 for v in body["hashtags"]):
                raise ResourceError("Invalid post hashtags")
            for key in ("link", "scheduleHint"):
                if args.get(key) is not None:
                    if not isinstance(args[key], str) or len(args[key]) > 2000:
                        raise ResourceError("Post link or schedule hint is too long")
                    body[key] = args[key]
            data, filename, mime = json.dumps(body, ensure_ascii=False, sort_keys=True).encode(), "post.json", "application/json"
        else:
            data = args.get("data")
            if args.get("file"):
                data = self.file_bytes(args["file"], workspace, limits[kind])
            if data is None and isinstance(args.get("content"), str):
                data = args["content"].encode("utf8")
            if not isinstance(data, bytes) or not data:
                raise ResourceError("Resource content is required")
            if kind == "image":
                mime, extension = image_type(data)
                alt = str(args.get("alt") or "")
                if (not person and not alt.strip()) or len(alt) > 4000:
                    raise ResourceError("Agent images require descriptive alt text (up to 4000 characters)")
                filename = "image." + extension
                extra_files["meta.json"] = json.dumps({"alt": alt}, ensure_ascii=False).encode()
            else:
                try:
                    text = data.decode("utf8")
                except UnicodeDecodeError:
                    raise ResourceError("Text resources must use UTF-8") from None
                filename, mime = ("index.html", "text/html") if kind == "html" else ("content.md", "text/plain")
                if kind == "html":
                    for token in TOKEN.findall(text):
                        image = await self.version(*split_ref(token))
                        if image["kind"] != "image" or image["missing"]:
                            raise ResourceError("HTML resource tokens must reference an available image version")
                        refs.append((image["id"], image["version"]))
        if len(data) > limits[kind]:
            raise ResourceError("Resource exceeds its size limit", 413)
        digest = hashlib.sha256(data + b"".join(extra_files[key] for key in sorted(extra_files))).hexdigest()
        if old:
            previous = await self.version(rid)
            if previous["sha256"] == digest and old["title"] == title and old["tags"] == tags and not args.get("force_version"):
                return {**previous, "unchanged": True}
        relative = f"{rid}/v{number}/{filename}"
        destination = self.path(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        for key, payload in {filename: data, **extra_files}.items():
            path = self.path(f"{rid}/v{number}/{key}")
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_bytes(payload)
            temporary.replace(path)
        now = now_ms()
        if old:
            await self.db.execute("UPDATE resources SET title=?,tags=?,current_version=?,updated_at=? WHERE id=?", (title, json.dumps(tags), number, now, rid))
        else:
            await self.db.execute("INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?,?,?)", (rid, kind, name, title, owner, thread, json.dumps(tags), number, 0, now, now))
        files = [f"{rid}/v{number}/{key}" for key in extra_files]
        await self.db.execute("INSERT INTO resource_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)", (rid, number, relative, json.dumps(files), mime, len(data), digest, "draft", note, f"bot:{owner}" if not person else "person", now))
        for target, target_version in set(refs):
            await self.db.execute("INSERT INTO resource_refs VALUES(?,?,?,?)", (rid, number, target, target_version))
        await self.db.commit()
        await self.prune(rid)
        result = await self.version(rid, number)
        self.bus.publish({"kind": "resource", "resource": result})
        return {**result, "unchanged": False}

    async def read(self, item):
        if item["missing"]:
            raise ResourceError(f"Resource {item['ref']} is missing", 404)
        data = self.path(item["path"]).read_bytes()
        if item["kind"] == "image":
            meta = next((p for p in item["files"] if p.endswith("/meta.json")), None)
            return {**item, "alt": json.loads(self.path(meta).read_text(encoding="utf8"))["alt"] if meta else ""}
        text = data.decode("utf8")
        result = {**item, "content": text[:100000], "truncated": len(text) > 100000}
        if item["kind"] == "post":
            result["post"] = json.loads(text)
        return result

    async def update(self, rid, args, *, owner=None, person=False, workspace=None, settings=None):
        async with self.lock:
            old = await self.version(rid)
            if not person and old["owner_bot"] != owner:
                raise ResourceError("Only the resource owner can edit it", 403)
            if args.get("base_version") != old["version"]:
                raise ResourceError("Resource changed; read the current version and retry", 409)
            restored = await self.version(rid, args["restore"]) if args.get("restore") else old
            read = await self.read(restored)
            payload = {"kind": old["kind"], "name": old["name"], "title": args.get("title", old["title"]), "tags": args.get("tags", old["tags"]), "note": args.get("note", ""), "base_version": old["version"]}
            if old["kind"] == "post":
                payload.update(read["post"])
                payload["images"] = read["post"]["media"]
                payload.pop("media", None)
                if "text" in args:
                    payload["text"] = args["text"]
                if "images" in args:
                    payload["images"] = args["images"]
                    payload["alts"] = args.get("alts", [])
                for key in ("platform", "hashtags", "link", "scheduleHint"):
                    if key in args:
                        payload[key] = args[key]
            elif old["kind"] == "image":
                payload.update(data=args.get("data", self.path(restored["path"]).read_bytes()), alt=args.get("alt", read["alt"]))
            else:
                payload["content"] = self.path(restored["path"]).read_text(encoding="utf8")
                if "content" in args or "text" in args:
                    payload["content"] = args.get("content", args.get("text"))
                if "data" in args:
                    try:
                        payload["content"] = args["data"].decode("utf8")
                    except UnicodeDecodeError:
                        raise ResourceError("Text resources must use UTF-8") from None
            key = "text" if old["kind"] == "post" else "content"
            if args.get("edits"):
                if key not in payload or not isinstance(args["edits"], list) or len(args["edits"]) > 100:
                    raise ResourceError("Exact edits require a text resource")
                for edit in args["edits"]:
                    if not isinstance(edit, dict):
                        raise ResourceError("Each edit must contain old and new text")
                    before, after = edit.get("old"), edit.get("new")
                    if not isinstance(before, str) or not before or not isinstance(after, str) or payload[key].count(before) != 1:
                        raise ResourceError("Each old text must match exactly once")
                    payload[key] = payload[key].replace(before, after, 1)
            if args.get("restore"):
                payload["force_version"] = True
            return await self._publish(payload, owner=old["owner_bot"], thread=old["thread_id"], workspace=workspace, person=person, settings=settings)

    async def set_status(self, rid, number, status, *, person=False, published_ref=None, note=None):
        async with self.lock:
            item = await self.version(rid, number)
            note_only = status is None and person and note is not None
            if note_only:
                status = item["status"]
            if status not in {"draft", "approved", "published"} or (not person and status == "approved") or (status == "published" and not note_only and published_ref != item["ref"]):
                raise ResourceError("Only a person may approve; publishing requires a run pinned to this version", 403)
            if status == "published" and item["status"] not in {"approved", "published"}:
                raise ResourceError("Approve this version before publishing", 409)
            if note is not None and (not isinstance(note, str) or len(note) > 1000):
                raise ResourceError("Resource note is too long")
            await self.db.execute("UPDATE resource_versions SET status=?,note=? WHERE resource_id=? AND version=?", (status, note if note is not None else item["note"], rid, number))
            await self.db.commit()
            result = await self.version(rid, number)
            self.bus.publish({"kind": "resource", "resource": result})
            return result

    async def prune(self, rid):
        cursor = await self.db.execute("SELECT version,path,files FROM resource_versions WHERE resource_id=? ORDER BY version DESC", (rid,))
        for number, path, files in (await cursor.fetchall())[10:]:
            if await self.used_by(rid, number):
                continue
            directory = self.path(path).parent
            if directory.exists():
                # Validated paths are confined to resources/<server id>/vN.
                shutil.rmtree(directory)
            await self.db.execute("DELETE FROM resource_refs WHERE source_id=? AND source_version=?", (rid, number))
            await self.db.execute("DELETE FROM resource_versions WHERE resource_id=? AND version=?", (rid, number))
        await self.db.commit()

    async def delete(self, rid, force=False):
        async with self.lock:
            item = await self.get(rid)
            uses = await self.used_by(rid)
            if uses and not force:
                raise ResourceError("Resource is in use; review Used by before deleting", 409)
            path = self.path(f"{rid}/v{item['current_version']}/placeholder").parent.parent
            if path.exists():
                shutil.rmtree(path)
            await self.db.execute("DELETE FROM resource_refs WHERE source_id=?", (rid,))
            await self.db.execute("DELETE FROM resource_versions WHERE resource_id=?", (rid,))
            await self.db.execute("DELETE FROM resources WHERE id=?", (rid,))
            await self.db.commit()
            self.bus.publish({"kind": "resource.deleted", "resourceId": rid})

    async def render_html(self, item):
        text = self.path(item["path"]).read_text(encoding="utf8")
        for token in set(TOKEN.findall(text)):
            image = await self.version(*split_ref(token))
            data = self.path(image["path"]).read_bytes()
            text = text.replace("{{resource:" + token + "}}", "data:" + image["mime"] + ";base64," + base64.b64encode(data).decode())
        return text

    async def materialize(self, item, workspace):
        read = await self.read(item)
        root = Path(workspace).resolve()
        destination = root / ".botteam" / "resources" / item["id"] / f"v{item['version']}"
        if not destination.resolve().is_relative_to(root):
            raise ResourceError("Unsafe materialized resource path")
        destination.mkdir(parents=True, exist_ok=True)
        copied = destination / Path(item["path"]).name
        if copied.is_symlink():
            raise ResourceError("Unsafe materialized resource path")
        copied.write_bytes(self.path(item["path"]).read_bytes())
        images = []
        for media in read.get("post", {}).get("media", []):
            image = await self.version(media["resource_id"], media["version"])
            child = await self.materialize(image, workspace)
            images.append({"ref": image["ref"], "path": child["file"], "alt": media["alt"]})
        return {**read, "file": str(copied), "images": images}
