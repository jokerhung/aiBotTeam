import asyncio
from pathlib import Path

from botteam.templates import load_templates
from botteam.wire import WireBot
from .test_api import ctx, make_bot  # noqa: F401


def test_offline_catalog():
    rows = load_templates()
    imported = [r for r in rows if r["industry"] != "general"]
    assert len(imported) == 28
    assert len({r["industry"] for r in imported}) == 7
    assert len({r["id"] for r in rows}) == len(rows)
    assert all(r["name"] and r["instructions"] for r in rows)
    assert len(rows) > 28


async def test_install_and_timestamps(ctx):
    c, app = ctx
    templates = (await c.get("/api/templates")).json()["templates"]
    r = await c.post(f"/api/templates/{templates[0]['id']}/install")
    assert r.status_code == 201
    bot = r.json()
    assert bot["soul"] == templates[0]["instructions"]
    assert bot["approvalMode"] == "ask"
    assert bot["createdAt"] and bot["updatedAt"]
    assert Path(bot["cwd"]).is_dir()
    assert (await c.post("/api/templates/missing/install")).status_code == 404
    await asyncio.sleep(.005)
    changed = (await c.patch(f"/api/bots/{bot['id']}", json={"name": "New name", "hidden": True})).json()
    assert changed["createdAt"] == bot["createdAt"]
    assert changed["updatedAt"] > bot["updatedAt"]
    assert changed["hidden"]
    restored = (await c.patch(f"/api/bots/{bot['id']}", json={"hidden": False})).json()
    assert not restored["hidden"]
    duplicated = (await c.post(f"/api/bots/{bot['id']}/duplicate")).json()
    assert duplicated["createdAt"] >= bot["createdAt"]
    # Persisted bot JSON from older installs must keep unknown dates, rather than inventing one.
    old = {k: v for k, v in bot.items() if k not in ("createdAt", "updatedAt")}
    assert WireBot.model_validate(old).createdAt is None


async def test_install_one_from_every_industry(ctx):
    c, _ = ctx
    rows = (await c.get("/api/templates")).json()["templates"]
    for industry in {r["industry"] for r in rows}:
        template = next(r for r in rows if r["industry"] == industry)
        response = await c.post(f"/api/templates/{template['id']}/install")
        assert response.status_code == 201
        bot = response.json()
        assert bot["name"] == template["name"][:60]
        assert bot["description"] == template["description"]
        assert bot["soul"] == template["instructions"]
        assert bot["approvalMode"] == "ask"
