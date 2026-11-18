"""sheet_rows: a bot finds rows of a Google Sheets file by column titles, in code, with the same answer every time, and the answers are kept for the
bot's cache time (a call within it is not made again; one after it is)."""
import re

from .test_api import ctx, make_bot  # noqa: F401  (fixture)

ALLOW = ["GOOGLESHEETS_SEARCH_SPREADSHEETS", "GOOGLESHEETS_GET_SHEET_NAMES", "GOOGLESHEETS_VALUES_GET"]
NAME = "Phân Đơn 2026 moi"
HEAD = ["lô", "CTN NO.", "ITEM NO", "DESCRIPTION", "CTN", "Q'TY/CTN", "Q'TY"] + [""] * 63
for i, h in {9: "ADC-HCM", 13: "VTS", 57: "CPS-HCM", 61: "A1", 65: "KHO", 66: "Kiện kho"}.items():
    HEAD[i] = h


TITLES = {"ADC_HCM": "ADC-HCM", "Kien_kho": "Kiện kho"}


def row(lot, ctn, item, qty, **cells):
    r = [lot, ctn, item, "x", "1", str(qty), str(qty)] + [""] * 63
    for i, v in cells.items():
        r[HEAD.index(TITLES.get(i, i))] = str(v)
    while r and r[-1] == "":
        r.pop()
    return r


def table():
    rows = [HEAD[:67]]
    rows += [row("1401 AO-W", str(n), "1", 5) for n in range(1, 326)]
    rows += [row("1401 AO", "291", "20882", 20, KHO=20, Kien_kho="OK")]
    rows += [row("1401 AO-W", "291", "99999", 7)]  # another lot with the same carton number: never mixed in
    rows += [row("1402 AO", str(n), "1", 5) for n in range(1, 1370)]
    rows += [row("1401 AO", "291", "20254", 16, ADC_HCM=16, KHO=0), row("1401 AO", "291", "55533", 46, VTS=19, A1=27, KHO=0)]
    return rows


TABLE = table()


def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


class FakeSheets:
    def __init__(self):
        self.calls = []

    async def tool_call(self, name, arguments):
        t = arguments["tools"][0]
        slug, a = t["tool_slug"], t["arguments"]
        self.calls.append((slug, str(a)))
        if slug == "GOOGLESHEETS_SEARCH_SPREADSHEETS":
            data = {"spreadsheets": [{"id": "S1", "name": "Copy of " + NAME, "modifiedTime": "2026-11-13T06:00:00Z"}, {"id": "S2", "name": NAME, "modifiedTime": "2026-11-13T05:00:00Z"}]}
        elif slug == "GOOGLESHEETS_GET_SHEET_NAMES":
            assert a["spreadsheet_id"] == "S2", "the file with the exact name, not the copy"
            data = {"sheet_names": ["Ton2 40-01.12", "101026", "301026", "280926", "PL Jisulife"]}
        elif slug == "GOOGLESHEETS_VALUES_GET":
            m = re.fullmatch(r"'(.*)'!([A-Z]+)(\d+):([A-Z]+)(\d+)", a["range"])
            tab, c1, r1, c2, r2 = m.group(1), col_index(m.group(2)), int(m.group(3)), col_index(m.group(4)), int(m.group(5))
            if tab != "301026":
                data = {"values": [HEAD[:7]] if r1 == 1 else []}
            else:
                data = {"values": [self._trim(rr[c1:c2 + 1] if len(rr) > c1 else []) for rr in TABLE[r1 - 1:r2]]}
        else:
            raise AssertionError(slug)
        return {"successful": True, "data": {"results": [{"response": {"successful": True, "data": data}, "tool_slug": slug}]}}

    @staticmethod
    def _trim(b):
        b = list(b)
        while b and b[-1] == "":
            b.pop()
        return b


async def setup(ctx, minutes=15, allow=ALLOW):
    c, app = ctx
    f = FakeSheets()
    comp = app.state.composio
    comp._tool_call = f.tool_call
    comp.config.set_secret("composio:apiKey", "ak_testkey1234567890")
    sid, _ = await app.state.mcp.create({"name": "Composio", "transport": "http", "url": "http://127.0.0.1:9/mcp", "appId": "composio"})
    bot = await make_bot(c, "Lookup")
    r = await c.patch(f"/api/bots/{bot['id']}", json={"mcpServers": [sid], "mcpAccess": {sid: {"scope": "write", "outbound": "allow", "allowTools": allow, **({"cacheMinutes": minutes} if minutes else {})}}})
    assert r.status_code == 200, r.text
    return app, f, bot, comp


async def test_rows_are_found_by_column_titles_for_the_exact_lot_and_carton(ctx):
    app, f, bot, comp = await setup(ctx)
    out = await app.state.agents.call(bot["threadId"], "sheet_rows", {"spreadsheet": NAME, "match": {"lô": "1401 ao", "CTN NO.": "291"}})
    assert out["ok"] and out["tab"] == "301026" and out["searchedTabs"] == ["301026"], "the newest day tab with a match, and the search stops there"
    by_item = {r["ITEM NO"]: r for r in out["rows"]}
    assert set(by_item) == {"20882", "20254", "55533"}, "the lot 1401 AO-W with the same carton number is not mixed in"
    assert by_item["55533"] == {"lô": "1401 AO", "CTN NO.": "291", "ITEM NO": "55533", "DESCRIPTION": "x", "CTN": "1", "Q'TY/CTN": "46", "Q'TY": "46", "VTS": "19", "A1": "27", "KHO": "0"}
    assert by_item["20254"]["ADC-HCM"] == "16" and "CPS-HCM" not in by_item["20254"], "columns are named by their titles, never by a count"
    assert by_item["20882"]["Kiện kho"] == "OK" and by_item["20882"]["KHO"] == "20"
    assert out["rowNumbers"][0] == 327 and len(out["rowNumbers"]) == 3
    ranges = [a for slug, a in f.calls if slug == "GOOGLESHEETS_VALUES_GET"]
    assert any("B1:B1500" in a for a in ranges) and any("B1501:B3000" in a for a in ranges), "a long column is read in chunks of 1500 rows until one comes back short"


async def test_a_bot_without_the_sheet_tools_gets_nothing_and_a_bad_request_is_explained(ctx):
    app, f, bot, comp = await setup(ctx, allow=["GOOGLESHEETS_SEARCH_SPREADSHEETS"])
    out = await app.state.agents.call(bot["threadId"], "sheet_rows", {"spreadsheet": NAME, "match": {"lô": "1"}})
    assert out["ok"] is False and out["reason"] == "not_allowed" and f.calls == []
    c, app2 = ctx
    sid = await comp._mcp_id()
    await c.patch(f"/api/bots/{bot['id']}", json={"mcpAccess": {sid: {"scope": "write", "outbound": "allow", "allowTools": ALLOW, "cacheMinutes": 15}}})
    bot2 = bot
    assert (await app2.state.agents.call(bot2["threadId"], "sheet_rows", {"spreadsheet": NAME}))["reason"] == "bad_request"
    missing = await app2.state.agents.call(bot2["threadId"], "sheet_rows", {"spreadsheet": NAME, "match": {"nope": "1"}, "tab": "301026"})
    assert missing["reason"] == "no_column" and "lô" in missing["columns"]
    none = await app2.state.agents.call(bot2["threadId"], "sheet_rows", {"spreadsheet": "No such file", "match": {"lô": "1"}})
    assert none["reason"] == "not_found"


async def test_a_lot_that_is_not_there_says_which_tabs_were_searched(ctx):
    app, f, bot, comp = await setup(ctx)
    out = await app.state.agents.call(bot["threadId"], "sheet_rows", {"spreadsheet": NAME, "match": {"lô": "9999 ZZ", "CTN NO.": "1"}})
    assert out["ok"] and out["rows"] == [] and out["searchedTabs"] == ["301026", "101026", "280926"], "the day tabs, newest first (30/10/26, 10/10/26, 28/09/26)"


async def test_answers_are_kept_for_the_cache_time_and_fetched_again_after_it(ctx):
    app, f, bot, comp = await setup(ctx, minutes=15)
    ask = {"spreadsheet": NAME, "match": {"lô": "1401 AO", "CTN NO.": "291"}}
    first = await app.state.agents.call(bot["threadId"], "sheet_rows", ask)
    n = len(f.calls)
    assert n > 0
    again = await app.state.agents.call(bot["threadId"], "sheet_rows", ask)
    assert len(f.calls) == n, "the same lookup within 15 minutes makes no call"
    assert again["rows"] == first["rows"] and again["fetchedAt"] == first["fetchedAt"]
    # 15 minutes after it was fetched: fetched again (the time runs from the fetch, not from the last use)
    import json
    import time

    for p in comp._answers_dir().glob("*.json"):
        d = json.loads(p.read_text(encoding="utf8"))
        d["at"] = time.time() - 15 * 60 - 1
        p.write_text(json.dumps(d), encoding="utf8")
    third = await app.state.agents.call(bot["threadId"], "sheet_rows", ask)
    assert len(f.calls) == 2 * n and third["fetchedAt"] > first["fetchedAt"]
    # no cache time: every call goes to the sheet
    c, _ = ctx
    sid = await comp._mcp_id()
    await c.patch(f"/api/bots/{bot['id']}", json={"mcpAccess": {sid: {"scope": "write", "outbound": "allow", "allowTools": ALLOW}}})
    app2, f2, bot2 = app, f, bot
    f2.calls.clear()
    await app2.state.agents.call(bot2["threadId"], "sheet_rows", ask)
    k = len(f2.calls)
    await app2.state.agents.call(bot2["threadId"], "sheet_rows", ask)
    assert len(f2.calls) == 2 * k
