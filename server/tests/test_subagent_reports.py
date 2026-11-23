from types import SimpleNamespace

from botteam.runtime import Runtime


async def make_report(tmp_path, result, limit):
    async def result_limit(_):
        return limit

    async def children(_):
        return [{"id": "research-job", "assignee_bot": "research", "reply": "resume", "outcome": "completed",
                 "status": "completed", "evidence": {}, "result": result, "outcome_detail": ""}]

    host = SimpleNamespace(bot_name=lambda _: "Research", result_limit=result_limit)
    runtime = Runtime(str(tmp_path / "runtime.db"), host)
    runtime.children = children
    return await runtime._input_for({"id": "master-job", "assignee_bot": "master", "requester": {"kind": "person", "name": "Person"}, "cut": False}, "resume")


async def test_async_report_preserves_all_repos_within_configured_limit(tmp_path):
    result = "Repo one\n" + "description " * 160 + "\nRepo two https://github.com/example/two\nRepo five https://github.com/example/five"
    assert 1500 < len(result) < 4000
    report = await make_report(tmp_path, result, 4000)
    assert result in report
    assert "Report truncated" not in report


async def test_report_marks_truncation_and_identifies_saved_full_result(tmp_path):
    result = "x" * 800 + "TAIL"
    report = await make_report(tmp_path, result, 500)
    assert "TAIL" not in report
    assert "Report truncated: 804 characters; showing 500" in report
    assert "assignment_status(id='research-job')" in report
