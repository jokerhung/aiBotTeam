import base64
import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import pytest

from botteam.resources import ResourceError, Resources
from botteam.store import Store
from botteam.bus import Bus
from .test_api import ctx, make_bot  # noqa: F401


def png():
    return base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0akAAAAASUVORK5CYII=")


async def test_versions_content_on_disk_exact_edits_and_move(ctx, tmp_path):
    client, app = ctx
    resource = (await client.post("/api/resources", json={"kind": "markdown", "name": "report", "content": "SECRET_CONTENT_A"})).json()
    assert resource["version"] == 1 and resource["ref"].endswith("@v1")
    again = (await client.post("/api/resources", json={"kind": "markdown", "name": "report", "content": "SECRET_CONTENT_A"})).json()
    assert again["unchanged"] and again["version"] == 1
    url = f"/api/resources/{resource['id']}"
    updated = (await client.post(url + "/versions", json={"base_version": 1, "edits": [{"old": "SECRET_CONTENT_A", "new": "SECRET_CONTENT_B"}]})).json()
    assert updated["version"] == 2
    assert (await client.get(resource["url"])).text == "SECRET_CONTENT_A"
    assert (await client.post(url + "/versions", json={"base_version": 1, "text": "stale"})).status_code == 409
    assert (await client.post(url + "/versions", json={"base_version": 2, "edits": [{"old": "missing", "new": "x"}]})).status_code == 400
    cursor = await app.state.store.db.execute("SELECT * FROM resource_versions")
    assert "SECRET_CONTENT" not in str(await cursor.fetchall())
    assert not Path(updated["path"]).is_absolute() and ".." not in updated["path"]
    moved = tmp_path / "moved"
    shutil.copytree(app.state.resources.root, moved / "resources")
    relocated = Resources(app.state.store, moved, Bus())
    assert (await relocated.read(await relocated.version(resource["id"], 1)))["content"] == "SECRET_CONTENT_A"
    await app.state.store.db.execute("UPDATE resource_versions SET path='../outside' WHERE resource_id=? AND version=1", (resource["id"],))
    await app.state.store.db.commit()
    with pytest.raises(ResourceError, match="Unsafe"):
        await app.state.resources.version(resource["id"], 1)


async def test_post_images_pinned_and_html_isolation(ctx):
    client, app = ctx
    image = (await client.post("/api/resources", data={"name": "picture", "alt": "Blue square"}, files={"file": ("photo.png", png(), "image/png")})).json()
    assert image["version"] == 1
    post = (await client.post("/api/resources", json={"kind": "post", "name": "post", "text": "Exact caption", "platform": "threads", "images": [image["ref"]]})).json()
    content = (await client.get(post["url"])).json()
    assert content["media"] == [{"resource_id": image["id"], "version": 1, "alt": "Blue square"}]
    assert (await client.post("/api/resources", json={"kind": "post", "name": "invalid", "text": "caption", "platform": "x", "media": [{"resource_id": image["id"]}]})).status_code == 400
    html = (await client.post("/api/resources", json={"kind": "html", "name": "page", "content": '<script>window.test=1</script><img src="{{resource:' + image["ref"] + '}}">'})).json()
    response = await client.get(html["url"])
    assert "sandbox allow-scripts" in response.headers["content-security-policy"]
    assert "allow-same-origin" not in response.headers["content-security-policy"]
    assert "data:image/png;base64," in response.text
    assert (await client.post("/api/resources", json={"kind": "html", "name": "bad-page", "content": "{{resource:" + image["id"] + "}}"})).status_code == 400
    assert (await client.delete(f"/api/resources/{image['id']}")).status_code == 409


async def test_retention_keeps_ten_and_versions_in_use(ctx):
    client, app = ctx
    service = app.state.resources
    first = await service.publish({"kind": "markdown", "name": "history", "content": "Version 1"}, person=True)
    bot = await make_bot(client)
    routine = await app.state.routines.create(target_kind="bot", target_id=bot["id"], name="Pinned", prompt="Review {resource.ref}", kind="interval", every_min=30, resource_id=first["id"], resource_version=1, enabled=False)
    for i in range(2, 13):
        result = await service.publish({"kind": "markdown", "name": "history", "content": f"Version {i}"}, person=True)
    versions = await service.versions(first["id"])
    assert [v["version"] for v in versions] == list(range(12, 2, -1)) + [1]
    assert versions[-1]["in_use"]
    await app.state.routines.update(routine["id"], resource_version=12)
    assert [v["version"] for v in await service.versions(first["id"])] == list(range(12, 2, -1))
    result = await service.publish({"kind": "markdown", "name": "history", "content": "Version 13"}, person=True)
    assert result["version"] == 13
    assert result["version_count"] == 10


async def test_agent_gates_ownership_workspace_and_status(ctx, tmp_path):
    client, app = ctx
    first, second = await make_bot(client, "Writer"), await make_bot(client, "Other")
    bot = await app.state.store.get_bot(first["id"])
    outside = tmp_path / "outside.md"
    outside.write_text("outside")
    with pytest.raises(ResourceError, match="workspace"):
        await app.state.resources.publish({"kind": "markdown", "name": "outside", "file": str(outside)}, owner=bot.id, workspace=bot.cwd)
    item = await app.state.resources.publish({"kind": "markdown", "name": "private", "content": "Original"}, owner=bot.id)
    with pytest.raises(ResourceError, match="owner"):
        await app.state.resources.update(item["id"], {"base_version": 1, "text": "Hijacked"}, owner=second["id"])
    with pytest.raises(ResourceError):
        await app.state.resources.set_status(item["id"], 1, "approved")
    await client.patch(f"/api/bots/{bot.id}", json={"toolbox": {"resources": {"enabled": False}}})
    result = await app.state.agents.call(bot.threadId, "publish_resource", {"kind": "markdown", "name": "disabled", "content": "x"})
    assert result["reason"] == "capability_disabled"


async def test_routine_approval_pins_version_and_materializes_media(ctx):
    client, app = ctx
    bot = await make_bot(client)
    image = await app.state.resources.publish({"kind": "image", "name": "photo", "data": png(), "alt": "Blue image"}, person=True)
    item = await app.state.resources.publish({"kind": "post", "name": "pinned-post", "text": "APPROVED TEXT", "platform": "threads", "images": [image["ref"]]}, person=True)
    routine = await app.state.routines.create(target_kind="bot", target_id=bot["id"], name="Draft post", prompt="Do not publish. Review {resource.ref}", kind="interval", every_min=30, resource_id=item["id"], enabled=False)
    assert routine["resource_version"] == 1 and routine["require_approved"]
    skipped = await app.state.routines.start_run(routine)
    assert skipped["status"] == "skipped" and "not approved" in skipped["detail"]
    await app.state.resources.set_status(item["id"], 1, "approved", person=True)
    newer = await app.state.resources.update(item["id"], {"base_version": 1, "text": "NEW DRAFT"}, person=True)
    captured = []
    async def deliver(r, run):
        captured.append(r["prompt"])
        return bot["threadId"]
    app.state.routines._deliver = deliver
    run = await app.state.routines.start_run(routine)
    assert run["status"] == "running" and run["detail"] == item["ref"]
    assert "APPROVED TEXT" in captured[0] and "NEW DRAFT" not in captured[0]
    assert image["ref"] in captured[0]
    target = await app.state.store.get_bot(bot["id"])
    assert (Path(target.cwd) / ".botteam/resources" / image["id"] / "v1/image.png").is_file()
    assert newer["version"] == 2 and newer["status"] == "draft"


async def test_native_tools_cards_limits_and_publication_gate(ctx):
    client, app = ctx
    bot = await make_bot(client)
    thread = bot["threadId"]
    app.state.turns.runs[thread] = SimpleNamespace(bot_id=bot["id"], routine_run_id=None, group_id=None, live=None)
    try:
        result = await app.state.agents.call(thread, "publish_resource", {"kind": "markdown", "name": "native-card", "content": "# Native card"})
        assert result["ok"] and result["version"] == 1, result
        messages = (await client.get(f"/api/bots/{bot['id']}/messages")).json()["messages"]
        card = next(message for message in messages if message["kind"] == "resource")
        assert card["resource"] == {"resource_id": result["id"], "version": 1, "kind": "markdown", "title": "native-card"}
        assert not card["text"]
        updated = await app.state.agents.call(thread, "update_resource", {"id": result["id"], "base_version": 1, "text": "# Updated card"})
        assert updated["ok"] and updated["version"] == 2
        denied = await app.state.agents.call(thread, "set_resource_status", {"ref": updated["ref"], "status": "approved"})
        assert not denied["ok"]
        await client.patch(f"/api/resources/{result['id']}/versions/1", json={"status": "approved"})
        denied = await app.state.agents.call(thread, "set_resource_status", {"ref": result["ref"], "status": "published"})
        assert not denied["ok"]
        routine = await app.state.routines.create(target_kind="bot", target_id=bot["id"], name="Audit", prompt="Review only", kind="interval", every_min=30, resource_id=result["id"], resource_version=1, enabled=False)
        run = await app.state.store.create_run(routine["id"], 1, "running", thread, result["ref"])
        app.state.turns.runs[thread].routine_run_id = run["id"]
        denied = await app.state.agents.call(thread, "set_resource_status", {"ref": updated["ref"], "status": "published"})
        assert not denied["ok"]
        published = await app.state.agents.call(thread, "set_resource_status", {"ref": result["ref"], "status": "published"})
        assert published["ok"] and published["status"] == "published"
        triggered = await app.state.routines.tool_trigger(thread, {"action": "create", "name": "Pinned from tool", "prompt": "Review only", "kind": "interval", "every_min": 30, "resource_id": result["id"], "enabled": False})
        assert triggered["ok"] and triggered["resource_version"] == 2
        assert triggered["resource_id"] == result["id"]
        note = await client.patch(f"/api/resources/{result['id']}/versions/1", json={"note": "Reviewed"})
        assert note.json()["status"] == "published" and note.json()["note"] == "Reviewed"
        app.state.turns.runs.pop(thread)
        await app.state.routines.cancel_run(run["id"])
        assert (await app.state.store.get_run(run["id"]))["detail"].startswith(result["ref"])
    finally:
        app.state.turns.runs.pop(thread, None)


async def test_resource_invalid_files_settings_and_truncated_reads(ctx):
    client, app = ctx
    for filename, data, expected in (("photo.svg", b"<svg/>", 400), ("large.png", png() + b"x" * (10 * 1024**2), 413)):
        assert (await client.post("/api/resources", data={"name": "invalid-image"}, files={"file": (filename, data)})).status_code == expected
    assert (await client.post("/api/resources", json={"kind": "post", "name": "invalid-post", "platform": "threads", "text": "Test", "hashtags": None})).status_code == 400
    bot = await make_bot(client)
    from botteam.toolbox import ResourcesSettings
    for kind, content, prefs in (("html", "<p>test</p>", ResourcesSettings(allowHtml=False)), ("markdown", "x" * 1025, ResourcesSettings(maxMarkdownBytes=1024))):
        with pytest.raises(ResourceError):
            await app.state.resources.publish({"kind": kind, "name": "restricted", "content": content}, owner=bot["id"], settings=prefs)
    long = await app.state.resources.publish({"kind": "markdown", "name": "long-read", "content": "x" * 110000}, person=True)
    read = (await client.get(f"/api/resources/{long['id']}/versions/1")).json()
    assert read["truncated"] and len(read["content"]) == 100000
    assert len((await client.get(long["url"])).content) == 110000
    app.state.resources.path(long["path"]).unlink()
    assert (await app.state.resources.version(long["id"]))["missing"]
    routine = await app.state.routines.create(target_kind="bot", target_id=bot["id"], name="Missing", prompt="Review only", kind="interval", every_min=30, resource_id=long["id"], enabled=False)
    assert (await app.state.routines.start_run(routine))["status"] == "skipped"


async def test_resource_backup_restores_relative_content(ctx, tmp_path):
    from botteam.backup import make_backup, restore
    import zipfile
    client, app = ctx
    item = await app.state.resources.publish({"kind": "markdown", "name": "backup", "content": "Backup text"}, person=True)
    # The API fixture uses t.db; production's canonical database name is messages.db.
    (app.state.resources.root.parent / "messages.db").touch()
    archive = tmp_path / "backup.zip"
    make_backup(app.state.resources.root.parent, archive)
    with zipfile.ZipFile(archive) as saved:
        assert "resources/" + item["path"] in saved.namelist()
    relocated = tmp_path / "restored"
    restore(archive, relocated)
    assert (relocated / "resources" / item["path"]).read_text(encoding="utf8") == "Backup text"


async def test_a_post_without_images_is_flagged_to_the_agent(ctx):
    from types import SimpleNamespace
    client, app = ctx
    first = await make_bot(client, "Creator")
    bot = await app.state.store.get_bot(first["id"])
    thread = bot.threadId
    app.state.turns.runs[thread] = SimpleNamespace(bot_id=bot.id, group_id=None, inp=None)
    try:
        plain = await app.state.agents.call(thread, "publish_resource", {"kind": "post", "name": "no-picture", "platform": "threads", "text": "Only words"})
        assert plain["ok"] and "NO images" in plain["warning"], plain
        picture = Path(bot.cwd) / "pic.png"
        picture.parent.mkdir(parents=True, exist_ok=True)
        picture.write_bytes(png())
        fixed = await app.state.agents.call(thread, "update_resource", {"id": plain["id"], "base_version": plain["version"], "images": [str(picture)], "alts": ["A dot"]})
        assert fixed["ok"] and "warning" not in fixed and fixed["version"] == 2, fixed
        withimg = await app.state.agents.call(thread, "publish_resource", {"kind": "post", "name": "with-picture", "platform": "threads", "text": "Words", "images": [str(picture)], "alts": ["A dot"]})
        assert withimg["ok"] and "warning" not in withimg
    finally:
        app.state.turns.runs.pop(thread, None)
