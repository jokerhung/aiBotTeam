"""intake.md (specs/intake-md.md): the file's checks, the default file, reading a caption, the folders photos go to, and the files API."""
from datetime import datetime
from pathlib import Path

import pytest

from botteam.channels import intake as ik
from botteam.workspaces import workspace_for, workspaces_root

from .test_api import ctx, make_bot  # noqa: F401  (fixture)

WITH_MACHINES = ik.default_text("collect").replace(
    'save:\n  path: "jobs/{session}/"', 'save:\n  path: "{machine}/{date}/{phase}/"\n  phases:\n    Truoc: [trước, truoc]\n    Sau: [sau]')
MACHINES = ik.MACHINES_SAMPLE + "| BH FLEX M10 | 1000000350 | |\n| BH FLEX M2 | 1000000343 | flex m2 |\n"


# ---- the default file ---------------------------------------------------------------------------------------------------------------
def test_the_default_file_checks_and_says_wait_30_seconds_then_save_into_jobs_session():
    st = ik.parse(ik.default_text("collect"))
    assert st.valid and not st.warnings
    assert st.cfg["mode"] == "collect" and st.cfg["quietSeconds"] == 30 and st.cfg["button"] is True
    assert st.cfg["path"] == "jobs/{session}/" and st.cfg["maxPhotos"] == 40 and st.cfg["timeoutSec"] == 900 and st.cfg["retentionDays"] == 60
    assert "{out}" in st.cfg["prompt"] and st.cfg["body"].startswith("# Quy trình nhận tin")
    answer = ik.parse(ik.default_text("answer"))
    assert answer.valid and answer.cfg["mode"] == "answer" and answer.cfg["quietSeconds"] == 0
    assert ik.summary(st.cfg) == "Runs after 30 s without news · saves to jobs/{session}/" and ik.summary(answer.cfg) == "Answers every message"


def test_an_older_grants_values_carry_over_and_its_job_folders_become_the_session_folder():
    text = ik.default_text("collect", prompt=ik.legacy_prompt("Đọc {job}/images/ và {job}/files/, ghi {job}/out/report.xlsx rồi trả lời."), limits={"maxPhotos": 12, "timeoutSec": 120, "remindAt": "18:30"})
    st = ik.parse(text)
    assert st.valid and st.cfg["maxPhotos"] == 12 and st.cfg["timeoutSec"] == 120 and st.cfg["remindAt"] == "18:30"
    assert st.cfg["prompt"] == "Đọc {folder} và {folder}, ghi {out}report.xlsx rồi trả lời."
    assert ik.legacy_prompt("{job}/images/ {job}/out/ {job}") == "{folder} {out} {folder}"


@pytest.mark.parametrize("old,new,line,why", [
    ("quietSeconds: 30", "quietSeconds: 5", 6, "quietSeconds"),
    ("quietSeconds: 30", "quietSeconds: abc", 6, "quietSeconds"),
    ("mode: collect", "mode: maybe", 4, "mode"),
    ("version: 1", "version: 2", 3, "version"),
    ('path: "jobs/{session}/"', 'path: "jobs/{session}"', 9, "save.path"),
    ('path: "jobs/{session}/"', 'path: "../out/"', 9, "save.path"),
    ('path: "jobs/{session}/"', 'path: "/etc/"', 9, "save.path"),
    ('path: "jobs/{session}/"', 'path: "C:/x/"', 9, "save.path"),
    ('path: "jobs/{session}/"', 'path: "jobs/{sender}/"', 9, "sender"),
    ("maxPhotos: 40", "maxPhotos: 500", 14, "maxPhotos"),
    ("format: botteam.intake", "format: other", 2, "format"),
])
def test_a_file_that_does_not_check_says_which_line_and_why(old, new, line, why):
    st = ik.parse(ik.default_text("collect").replace(old, new))
    assert not st.valid and not st.cfg and why in st.error
    assert st.line == line, (st.error, st.line)


def test_broken_yaml_a_missing_block_and_a_button_that_leaves_no_way_to_run_are_refused():
    assert ik.parse("no front matter here").line == 1
    assert "YAML" in ik.parse("---\nformat: [oops\n---\n").error
    no_way = ik.default_text("collect").replace("quietSeconds: 30", "quietSeconds: 0").replace("button: true", "button: false")
    assert "button" in ik.parse(no_way).error
    big = ik.default_text("collect") + "x" * ik.MAX_INTAKE
    assert "too large" in ik.parse(big).error
    st = ik.parse(ik.default_text("collect").replace("limits:", "mystery: 1\nlimits:"))
    assert st.valid and any("mystery" in w for w in st.warnings), "an unknown setting is a warning, not an error"


def test_a_path_with_machine_needs_machines_md_and_a_path_with_phase_needs_phases():
    assert "machines.md" in ik.parse(WITH_MACHINES, None).error
    assert ik.parse(WITH_MACHINES, ik.MACHINES_SAMPLE).valid
    no_phases = WITH_MACHINES.replace("  phases:\n    Truoc: [trước, truoc]\n    Sau: [sau]", "")
    assert "phases" in ik.parse(no_phases, ik.MACHINES_SAMPLE).error
    assert "Tên chuẩn" in ik.parse(WITH_MACHINES, "| Foo | Bar |\n|---|---|\n| a | b |\n").error


# ---- reading a caption -------------------------------------------------------------------------------------------------------------
@pytest.fixture
def cfg():
    return ik.parse(WITH_MACHINES, MACHINES).cfg


def read(cap, cfg):
    r = ik.read_caption(cap, cfg, ik.parse_machines(MACHINES))
    return (r["machine"].name if r["machine"] else None, r["phase"])


def test_a_caption_names_a_machine_and_a_phase_even_when_it_is_misspelt(cfg):
    assert read("Máy BH Flex M1 trước", cfg) == ("BH FLEX M1", "Truoc")
    assert read("may bh flx m1 sau", cfg) == ("BH FLEX M1", "Sau")
    assert read("1000000342 TRƯỚC", cfg) == ("BH FLEX M1", "Truoc"), "the machine's code works too"
    assert read("flex m2 sau", cfg) == ("BH FLEX M2", "Sau"), "an alias"
    assert read("máy bh flex m1", cfg) == ("BH FLEX M1", None)


def test_every_number_must_match_so_m1_is_never_m10_and_an_unknown_machine_is_not_guessed(cfg):
    assert read("BH FLEX M10 trước", cfg) == ("BH FLEX M10", "Truoc")
    assert read("flex m3 trước", cfg) == (None, "Truoc")
    assert read("BH FLEX M1 trước và sau", cfg) == ("BH FLEX M1", None) or read("BH FLEX M1 trước và sau", cfg)[1] is None, "two phases named: none"
    machine, near = ik.match_machine("bh flex m3", ik.parse_machines(MACHINES))
    assert machine is None and "BH FLEX M1" in near, "the closest names are offered"


# ---- folders -----------------------------------------------------------------------------------------------------------------------
def test_the_folder_is_built_from_the_template_and_can_never_leave_the_working_folder(tmp_path, cfg):
    vals = {"machine": "BH FLEX M1", "date": "2026-11-18", "phase": "Truoc", "session": "b_x", "chat": "42"}
    assert ik.build_folder(cfg, vals, tmp_path) == (tmp_path.resolve() / "BH FLEX M1" / "2026-11-18" / "Truoc")
    for evil in ("../../x", "C:\\Windows\\System32", "a/../../b", "..", "con:", "x" * 500, "  ..  "):
        got = ik.build_folder(cfg, {**vals, "machine": evil}, tmp_path)
        assert got.is_relative_to(tmp_path.resolve()) and got != tmp_path.resolve(), evil
        assert all(ch not in got.relative_to(tmp_path.resolve()).as_posix() for ch in ':*?"<>|\\'), evil
    assert ik.clean_segment("Máy ·  Nước/Cam: 1.") == "Máy · Nước Cam 1"
    with pytest.raises(ik.IntakeError):
        ik.build_folder({**cfg, "path": "{machine}/"}, {**vals, "machine": " . . "}, tmp_path)


def test_a_symlink_that_points_outside_is_not_followed(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    try:
        (work / "jobs").symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not available here")
    with pytest.raises(ik.IntakeError):
        ik.build_folder(ik.parse(ik.default_text("collect")).cfg, {"session": "b_x"}, work)


def test_the_working_folder_of_a_bot_is_made_under_workspaces_and_the_env_moves_it(tmp_path, monkeypatch):
    monkeypatch.delenv("BOTTEAM_WORKSPACES", raising=False)
    assert workspaces_root(None, False) == (Path.cwd() / "workspaces").resolve()
    assert workspaces_root(tmp_path, True) == (tmp_path / "workdirs").resolve()
    monkeypatch.setenv("BOTTEAM_WORKSPACES", str(tmp_path / "elsewhere"))
    root = workspaces_root(tmp_path, True)
    assert root == (tmp_path / "elsewhere").resolve()
    assert workspace_for(root, "bot_ab12").is_dir() and workspace_for(root, "../evil").parent == root


# ---- the files API -----------------------------------------------------------------------------------------------------------------
async def folder_bot(c, tmp_path, name="Intake"):
    bot = await make_bot(c, name)
    ws = tmp_path / f"ws_{name}"
    ws.mkdir()
    assert (await c.patch(f"/api/bots/{bot['id']}", json={"cwd": str(ws)})).status_code == 200
    return bot, ws


async def test_a_bot_is_made_with_a_working_folder_of_its_own_and_no_intake_md_until_it_has_an_input(ctx, tmp_path):
    c, app = ctx
    bot = await make_bot(c, "Plain")
    cwd = Path(bot["cwd"])
    assert cwd.is_dir() and cwd.name == bot["id"] and cwd.parent.name == "workdirs"
    assert not (cwd / "intake.md").exists()
    mine = (await c.post("/api/bots", json={"name": "Mine", "cwd": str(tmp_path)})).json()
    assert mine["cwd"] == str(tmp_path), "a folder the maker gave is kept"
    copy = (await c.post(f"/api/bots/{bot['id']}/duplicate")).json()
    assert copy["cwd"] == bot["cwd"], "a copy shares its source's folder"


async def test_the_intake_api_reads_checks_and_writes_only_the_two_files(ctx, tmp_path):
    c, app = ctx
    bot, ws = await folder_bot(c, tmp_path)
    base = f"/api/bots/{bot['id']}/intake"
    state = (await c.get(base)).json()
    assert state["hasFolder"] and not state["exists"] and not state["hasInput"]
    assert (await c.post(f"{base}/default")).status_code == 200 and (ws / "intake.md").is_file()
    assert (await c.post(f"{base}/default")).status_code == 409, "a file that is there is not replaced"
    state = (await c.get(base)).json()
    assert state["valid"] and state["summary"].startswith("Runs after 30 s")
    f = (await c.get(f"{base}/file", params={"name": "intake.md"})).json()
    assert f["exists"] and f["content"].startswith("---") and len(f["hash"]) == 16
    for bad in ("AGENTS.md", "../x.md", "intake.md/../../x"):
        assert (await c.get(f"{base}/file", params={"name": bad})).status_code == 400
        assert (await c.put(f"{base}/file", json={"name": bad, "content": "x", "hash": ""})).status_code == 400
    verdict = (await c.post(f"{base}/check", json={"name": "intake.md", "content": f["content"].replace("quietSeconds: 30", "quietSeconds: 5")})).json()
    assert verdict["valid"] is False and verdict["line"] == 6 and "quietSeconds" in verdict["error"]
    assert (ws / "intake.md").read_text(encoding="utf8") == f["content"], "checking writes nothing"
    good = f["content"].replace("quietSeconds: 30", "quietSeconds: 45")
    wrote = await c.put(f"{base}/file", json={"name": "intake.md", "content": good, "hash": f["hash"]})
    assert wrote.status_code == 200 and "45" in (await c.get(base)).json()["summary"]
    refused = await c.put(f"{base}/file", json={"name": "intake.md", "content": f["content"].replace("quietSeconds: 30", "quietSeconds: 5"), "hash": wrote.json()["hash"]})
    assert refused.status_code == 400 and refused.json()["line"] == 6
    assert "quietSeconds: 45" in (ws / "intake.md").read_text(encoding="utf8"), "a file that does not check is never written"
    assert not list(ws.glob(".intake.md.*")), "no half-written file is left"


async def test_a_file_changed_elsewhere_is_a_conflict_unless_forced_and_line_ends_are_kept(ctx, tmp_path):
    c, app = ctx
    bot, ws = await folder_bot(c, tmp_path)
    base = f"/api/bots/{bot['id']}/intake"
    await c.post(f"{base}/default")
    opened = (await c.get(f"{base}/file", params={"name": "intake.md"})).json()
    (ws / "intake.md").write_bytes(opened["content"].replace("quietSeconds: 30", "quietSeconds: 60").replace("\n", "\r\n").encode("utf8"))  # someone else, with Windows line ends
    mine = opened["content"].replace("quietSeconds: 30", "quietSeconds: 20")
    r = await c.put(f"{base}/file", json={"name": "intake.md", "content": mine, "hash": opened["hash"]})
    assert r.status_code == 409 and r.json()["conflict"] is True
    assert (await c.put(f"{base}/file", json={"name": "intake.md", "content": mine, "hash": opened["hash"], "force": True})).status_code == 200
    raw = (ws / "intake.md").read_bytes()
    assert b"quietSeconds: 20" in raw and raw.count(b"\r\n") == raw.count(b"\n") > 5, "the file kept its line ends"
    assert (await c.put(f"{base}/file", json={"name": "machines.md", "content": "| Foo |\n|---|\n", "hash": ""})).status_code == 400
    ok = await c.put(f"{base}/file", json={"name": "machines.md", "content": ik.MACHINES_SAMPLE, "hash": ""})
    assert ok.status_code == 200 and (ws / "machines.md").is_file()
    assert (await c.get(f"{base}/template", params={"name": "machines.md"})).json()["content"] == ik.MACHINES_SAMPLE
    assert "botteam.intake" in (await c.get(f"{base}/template")).json()["content"]


async def test_the_intake_api_is_refused_for_a_bot_without_a_folder(ctx, tmp_path):
    c, app = ctx
    a = (await c.post("/api/admin/open")).json()
    assert (await c.get(f"/api/bots/{a['id']}/intake/file", params={"name": "intake.md"})).status_code == 400
    state = (await c.get(f"/api/bots/{a['id']}/intake")).json()
    assert state["hasFolder"] is False
    assert datetime.now().year >= 2026


def test_a_session_can_end_with_a_reply_and_no_bot_run():
    st = ik.parse(ik.default_text("collect"))
    assert st.cfg["agent"] is True and "{summary}" in st.cfg["reply"]
    quiet = ik.default_text("collect").replace("run:\n", 'run:\n  agent: false\n  reply: "Đã nhận {photos} ảnh: {summary}"\n', 1)
    got = ik.parse(quiet)
    assert got.valid and got.cfg["agent"] is False and got.cfg["reply"] == "Đã nhận {photos} ảnh: {summary}" and not got.warnings
    assert "run.agent" in ik.parse(ik.default_text("collect").replace("run:\n", "run:\n  agent: maybe\n", 1)).error
