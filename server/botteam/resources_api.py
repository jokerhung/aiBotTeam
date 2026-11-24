"""The browser-facing resource library. Content URLs always pin a version."""
import json

from fastapi import HTTPException, Request
from fastapi.responses import Response

from .resources import ResourceError

CSP = "sandbox allow-scripts; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"


def register(app, resources):
    @app.exception_handler(ResourceError)
    async def resource_error(request: Request, exc: ResourceError):
        return Response(json.dumps({"detail": str(exc)}), status_code=exc.status, media_type="application/json")

    async def payload(request):
        if "multipart/form-data" in request.headers.get("content-type", ""):
            form = await request.form(max_files=1, max_fields=15, max_part_size=11 * 1024**2)
            upload = form.get("file")
            if upload is None or not hasattr(upload, "read"):
                raise ResourceError("Choose a resource file")
            data = await upload.read(10 * 1024**2 + 1)
            if len(data) > 10 * 1024**2:
                raise ResourceError("Resource exceeds its size limit", 413)
            kind = str(form.get("kind") or "image")
            result = {"kind": kind, "name": str(form.get("name") or "upload"), "title": str(form.get("title") or upload.filename), "alt": str(form.get("alt") or ""), "data": data}
            if form.get("base_version"):
                try:
                    result["base_version"] = int(str(form["base_version"]))
                except ValueError:
                    raise ResourceError("Invalid base version") from None
            return result
        body = await request.body()
        if len(body) > 3 * 1024**2:
            raise ResourceError("Resource exceeds its size limit", 413)
        try:
            data = json.loads(body)
        except ValueError:
            raise ResourceError("Invalid resource JSON") from None
        if not isinstance(data, dict) or data.get("file") or data.get("data"):
            raise ResourceError("Upload files using the resource file picker")
        return data

    @app.get("/api/resources")
    async def listing(kind: str | None = None, status: str | None = None, bot: str | None = None, q: str = "", limit: int = 50, archived: bool = False):
        return {"resources": await resources.list(kind=kind, status=status, bot=bot, query=q, limit=limit, archived=archived)}

    @app.post("/api/resources", status_code=201)
    async def create(request: Request):
        args = await payload(request)
        images = args.get("images", [])
        if args.get("kind") == "post" and isinstance(images, list) and any(isinstance(value, str) and not value.startswith("res_") for value in images):
            raise ResourceError("Upload images as Resources and use their versioned references")
        return await resources.publish(args, person=True)

    @app.get("/api/resources/{rid}")
    async def metadata(rid: str):
        return await resources.version(rid)

    @app.patch("/api/resources/{rid}")
    async def metadata_update(rid: str, body: dict):
        async with resources.lock:
            await resources.get(rid)
            for name in body:
                if name not in {"title", "tags", "archived"}:
                    raise ResourceError("Only title, tags and archived can change")
            if "title" in body and (not isinstance(body["title"], str) or not 0 < len(body["title"]) <= 200):
                raise ResourceError("Resource title must contain 1-200 characters")
            if "tags" in body and (not isinstance(body["tags"], list) or len(body["tags"]) > 10 or any(not isinstance(t, str) or len(t) > 50 for t in body["tags"])):
                raise ResourceError("Invalid resource tags")
            if "archived" in body and type(body["archived"]) is not bool:
                raise ResourceError("Invalid archive state")
            for key, value in body.items():
                await resources.db.execute(f"UPDATE resources SET {key}=? WHERE id=?", (json.dumps(value) if key == "tags" else value, rid))
            await resources.db.commit()
        item = await resources.version(rid)
        resources.bus.publish({"kind": "resource", "resource": item})
        return item

    @app.delete("/api/resources/{rid}")
    async def delete(rid: str, force: bool = False):
        await resources.delete(rid, force)
        return {"ok": True, "id": rid}

    @app.get("/api/resources/{rid}/versions")
    async def versions(rid: str):
        return {"versions": await resources.versions(rid)}

    @app.get("/api/resources/{rid}/used-by")
    async def used_by(rid: str):
        return {"id": rid, "used_by": await resources.used_by(rid)}

    @app.get("/api/resources/{rid}/versions/{number}")
    async def version(rid: str, number: int):
        return await resources.read(await resources.version(rid, number))

    @app.post("/api/resources/{rid}/versions", status_code=201)
    async def update(rid: str, request: Request):
        return await resources.update(rid, await payload(request), person=True)

    @app.patch("/api/resources/{rid}/versions/{number}")
    async def status(rid: str, number: int, body: dict):
        if body.get("status") not in {"draft", "approved"} and not ("status" not in body and "note" in body):
            raise ResourceError("People may approve a version or return it to draft")
        return await resources.set_status(rid, number, body.get("status"), person=True, note=body.get("note"))

    @app.get("/api/resources/{rid}/versions/{number}/content")
    async def content(rid: str, number: int, download: bool = False):
        item = await resources.version(rid, number)
        if item["missing"]:
            raise ResourceError("Resource file is missing", 404)
        data = await resources.render_html(item) if item["kind"] == "html" else resources.path(item["path"]).read_bytes()
        headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": CSP}
        if download:
            headers["Content-Disposition"] = f'attachment; filename="{item["name"]}.{item["path"].rsplit(".", 1)[-1]}"'
        return Response(data, media_type=item["mime"], headers=headers)

    @app.get("/api/resources/{rid}/versions/{number}/files/{name}")
    async def secondary_file(rid: str, number: int, name: str):
        item = await resources.version(rid, number)
        relative = next((path for path in item["files"] if path.rsplit("/", 1)[-1] == name), None)
        if not relative:
            raise HTTPException(404, "Resource file not found")
        return Response(resources.path(relative).read_bytes(), media_type="application/json", headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": CSP})
