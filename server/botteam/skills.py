"""Skills: SKILL.md files (frontmatter + instructions) in a library, given to bots and switched on or off.

    <data>/skills/<id>/SKILL.md      ---\\nname: ...\\ndescription: ...\\n---\\n<instructions>
    <data>/skills/<id>/meta.json     {"enabled": true}

For the Claude CLI a turn gets a directory with `.claude/skills/<id>/SKILL.md` for the skills the bot has and that are on (added with
--add-dir); another engine is given the same instructions in its system prompt.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path, PurePosixPath
from typing import Optional

from .memory import write_atomic

FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.S)
MAX_BODY = 40_000


class SkillError(ValueError):
    pass


def parse(text: str) -> dict:
    """{name, description, body} from a SKILL.md; a file without frontmatter is all body."""
    m = FRONT.match(text.replace("\r\n", "\n"))
    meta: dict[str, str] = {}
    body = text
    if m:
        body = m.group(2)
        for ln in m.group(1).split("\n"):
            if ":" in ln:
                k, v = ln.split(":", 1)
                meta[k.strip()] = v.strip().strip("\"'")
    return {"name": meta.get("name", ""), "description": meta.get("description", ""), "body": body.strip()}


def render(name: str, description: str, body: str) -> str:
    esc = lambda s: s.replace("\n", " ").strip()
    return f"---\nname: {esc(name)}\ndescription: {esc(description)}\n---\n{body.strip()}\n"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "skill"


class Skills:
    def __init__(self, home: Path) -> None:
        self.dir = home / "skills"
        self.run = home / "skill-run"

    def _path(self, sid: str) -> Path:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,47}", sid):
            raise SkillError("unknown skill")
        return self.dir / sid

    def _meta(self, sid: str) -> dict:
        try:
            return json.loads((self._path(sid) / "meta.json").read_text(encoding="utf8"))
        except (OSError, ValueError):
            return {}

    def list(self) -> list[dict]:
        if not self.dir.exists():
            return []
        out = []
        for d in sorted(self.dir.iterdir()):
            item = self.get(d.name)
            if item:
                out.append(item)
        return out

    def get(self, sid: str) -> Optional[dict]:
        try:
            root = self._path(sid)
        except SkillError:
            return None
        f = root / "SKILL.md"
        if not f.is_file():
            return None
        skill = parse(f.read_text(encoding="utf8"))
        meta = self._meta(sid)
        return {"id": sid, "name": skill["name"] or sid, "description": skill["description"], "body": skill["body"], "enabled": meta.get("enabled", True), "category": meta.get("category", ""), "industry": meta.get("industry", ""), "sourceKey": meta.get("sourceKey"), "files": self.files(sid)}

    def save(self, sid: Optional[str], name: str, description: str, body: str, enabled: Optional[bool] = None, category: Optional[str] = None) -> dict:
        name, description = name.strip(), description.strip()
        if not name or len(name) > 80:
            raise SkillError("a skill needs a name of up to 80 characters")
        if len(body) > MAX_BODY:
            raise SkillError("the instructions are too long")
        if category is not None and (not isinstance(category, str) or len(category) > 60):
            raise SkillError("invalid skill category")
        if sid is None:
            base, sid, n = slug(name), slug(name), 2
            while (self.dir / sid).exists():
                suffix = f"-{n}"
                sid, n = f"{base[:48-len(suffix)]}{suffix}", n + 1
        d = self._path(sid)
        write_atomic(d / "SKILL.md", render(name, description, body))
        meta = self._meta(sid)
        if enabled is not None:
            meta["enabled"] = bool(enabled)
        if category is not None:
            meta["category"] = category.strip()
        meta["enabled"] = meta.get("enabled", True)
        write_atomic(d / "meta.json", json.dumps(meta))
        return self.get(sid) or {}

    def files(self, sid: str) -> list[str]:
        root = self._path(sid)
        return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and not p.is_symlink() and not any(parent.is_symlink() for parent in p.parents if parent != root.parent) and p.name not in {"SKILL.md", "meta.json"})

    def file(self, sid: str, name: str) -> Path:
        root = self._path(sid).resolve()
        relative = PurePosixPath(name)
        if not name or "\\" in name or ":" in name or relative.is_absolute() or any(part in {"..", "."} for part in relative.parts) or name not in self.files(sid):
            raise SkillError("unknown skill file")
        target = root / name
        if not target.resolve().is_relative_to(root) or target.is_symlink():
            raise SkillError("unknown skill file")
        return target

    def gallery(self) -> dict:
        from .skill_gallery import catalog
        installed = self.list()
        industries = {}
        for entry in catalog()["skills"]:
            have = next((s for s in installed if s.get("sourceKey") == entry["key"] or s["name"].casefold() == entry["name"].casefold()), None)
            industries.setdefault(entry["industry"], []).append({**entry, "installed": bool(have), "installed_id": have["id"] if have else None})
        return {"industries": [{"id": industry, "skills": entries} for industry, entries in industries.items()], "revision": catalog()["revision"]}

    def install_gallery(self, keys: list[str]) -> dict:
        from .skill_gallery import ROOT, catalog, preview
        if not isinstance(keys, list) or not 0 < len(keys) <= 80 or any(not isinstance(key, str) for key in keys):
            raise SkillError("choose 1-80 gallery skills")
        # Validate the whole request before writing, including file paths.
        entries = [preview(key) for key in dict.fromkeys(keys)]
        installed, skipped = [], []
        existing_skills = self.list()
        for entry in entries:
            existing = next((s for s in existing_skills if s.get("sourceKey") == entry["key"] or s["name"].casefold() == entry["name"].casefold()), None)
            if existing:
                skipped.append({"key": entry["key"], "id": existing["id"]})
                continue
            item = self.save(None, entry["name"], entry["description"], entry["content"], category=entry["category"])
            root = self._path(item["id"])
            for name in entry["files"]:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / entry["key"] / name).read_bytes())
            meta = self._meta(item["id"])
            meta.update(sourceKey=entry["key"], industry=entry["industry"], sourceRevision=catalog()["revision"])
            write_atomic(root / "meta.json", json.dumps(meta))
            installed.append({"key": entry["key"], "id": item["id"]})
            existing_skills.append({**item, "sourceKey": entry["key"]})
        return {"installed": installed, "skipped": skipped}

    def delete(self, sid: str) -> bool:
        d = self._path(sid)
        if not d.exists():
            return False
        shutil.rmtree(d)
        return True

    def for_bot(self, bot_skills: list[str]) -> list[dict]:
        """The skills this bot has that are switched on."""
        have = {s["id"]: s for s in self.list()}
        return [have[i] for i in bot_skills if i in have and have[i]["enabled"]]

    def turn_dir(self, thread_id: str, skills: list[dict]) -> Optional[str]:
        """A directory with the skills in the layout the Claude CLI reads, for this turn; None when there are none."""
        if not skills:
            return None
        root = self.run / re.sub(r"[^\w-]", "_", thread_id)
        shutil.rmtree(root, ignore_errors=True)
        for s in skills:
            write_atomic(root / ".claude" / "skills" / s["id"] / "SKILL.md", render(s["name"], s["description"], s["body"]))
            for name in s.get("files", []):
                target = root / ".claude" / "skills" / s["id"] / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(self.file(s["id"], name).read_bytes())
        return str(root)

    def in_workspace(self, workspace: str, skills: list[dict]) -> list[dict]:
        """Other engines can open a skill's relative references inside their allowed workspace."""
        base = Path(workspace).resolve()
        prepared = []
        for skill in skills:
            root = base / ".botteam" / "skills" / skill["id"]
            if not root.resolve().is_relative_to(base):
                raise SkillError("unsafe skill workspace")
            for name in ["SKILL.md", *skill.get("files", [])]:
                target = root / name
                if not target.resolve().is_relative_to(base) or target.is_symlink():
                    raise SkillError("unsafe skill workspace")
                target.parent.mkdir(parents=True, exist_ok=True)
                data = render(skill["name"], skill["description"], skill["body"]).encode() if name == "SKILL.md" else self.file(skill["id"], name).read_bytes()
                if not target.is_file() or target.read_bytes() != data:
                    target.write_bytes(data)
            prepared.append({**skill, "directory": str(root)})
        return prepared

    def cleanup(self, thread_id: str) -> None:
        shutil.rmtree(self.run / re.sub(r"[^\w-]", "_", thread_id), ignore_errors=True)

    @staticmethod
    def as_text(skills: list[dict]) -> str:
        """The skills as instructions for an engine that has no skills directory."""
        if not skills:
            return ""
        return "\n\nSkills you have (follow the one that fits the task):\n" + "\n\n".join(f"## {s['name']}\n{s['description']}\n" + (f"Files directory: {s['directory']} (resolve relative links here).\n" if s.get("directory") else "") + s['body'] for s in skills)[:12000]
