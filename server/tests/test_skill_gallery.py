from pathlib import Path

import pytest

from botteam.skill_gallery import catalog, preview
from botteam.skills import SkillError, Skills
from .test_api import ctx, make_bot  # noqa: F401


def test_full_offline_gallery_and_idempotent_non_destructive_migration(tmp_path):
    library = Skills(tmp_path)
    keys = [skill["key"] for skill in catalog()["skills"]]
    assert len(keys) == 80 and len(library.gallery()["industries"]) == 7
    existing = library.save(None, "pull-request-review", "My trigger", "CUSTOM CONTENT", enabled=False, category="custom")
    first = library.install_gallery(keys)
    assert len(first["installed"]) == 79 and len(first["skipped"]) == 1
    assert len(library.list()) == 80
    assert library.get(existing["id"])["body"] == "CUSTOM CONTENT" and not library.get(existing["id"])["enabled"]
    assert len(library.install_gallery(keys)["skipped"]) == 80
    guide = next(s for s in library.list() if s["sourceKey"] == "software/agenticos-guide")
    assert len(guide["files"]) == 17
    assert "AgenticOS" in library.file(guide["id"], "docs/api.md").read_text(encoding="utf8")
    original = library.file(guide["id"], "docs/api.md").read_bytes()
    library.save(guide["id"], guide["name"], guide["description"], "USER EDIT", enabled=False)
    assert library.get(guide["id"])["sourceKey"] == "software/agenticos-guide"
    library.install_gallery(keys)
    assert library.get(guide["id"])["body"] == "USER EDIT"
    assert library.file(guide["id"], "docs/api.md").read_bytes() == original
    for bad in ("../meta.json", "docs/../../outside", "C:/outside", "docs\\api.md", "meta.json"):
        with pytest.raises(SkillError):
            library.file(guide["id"], bad)
    with pytest.raises(SkillError):
        library.install_gallery([keys[0], "../outside"])


def test_gallery_files_available_to_claude_and_other_engines(tmp_path):
    library = Skills(tmp_path / "data")
    result = library.install_gallery(["software/agenticos-guide"])
    skill = library.get(result["installed"][0]["id"])
    have = library.for_bot([skill["id"]])
    root = Path(library.turn_dir("test-thread", have))
    assert (root / ".claude/skills" / skill["id"] / "docs/api.md").is_file()
    workspace = tmp_path / "workspace"
    prepared = library.in_workspace(str(workspace), have)
    assert (Path(prepared[0]["directory"]) / "docs/api.md").is_file()
    assert str(workspace) in library.as_text(prepared)
    assert preview("software/agenticos-guide")["content"] == skill["body"]


async def test_gallery_api_preview_install_metadata_and_assignments(ctx):
    client, app = ctx
    gallery = (await client.get("/api/skills/gallery")).json()
    assert sum(len(i["skills"]) for i in gallery["industries"]) == 80
    detail = (await client.get("/api/skills/gallery/preview", params={"key": "software/agenticos-guide"})).json()
    assert len(detail["files"]) == 17 and detail["content"]
    assert (await client.post("/api/skills/gallery/install", json={"keys": ["../../outside"]})).status_code == 400
    installed = (await client.post("/api/skills/gallery/install", json={"keys": ["software/agenticos-guide"]})).json()
    sid = installed["installed"][0]["id"]
    assert (await client.get(f"/api/skills/{sid}/file", params={"name": "../../outside"})).status_code == 404
    assert (await client.get(f"/api/skills/{sid}/file", params={"name": "docs/api.md"})).json()["content"]
    assert len((await client.get(f"/api/skills/{sid}/files")).json()["files"]) == 17
    assert (await client.patch(f"/api/skills/{sid}", json={"category": "engineering", "body": "My edited guide"})).json()["category"] == "engineering"
    bot = await make_bot(client)
    await client.patch(f"/api/bots/{bot['id']}", json={"skills": [sid]})
    item = (await client.get("/api/skills")).json()["skills"][0]
    assert item["used_by"][0]["id"] == bot["id"] and len(item["files"]) == 17
    await client.delete(f"/api/skills/{sid}")
    assert not (await app.state.store.get_bot(bot["id"])).skills
