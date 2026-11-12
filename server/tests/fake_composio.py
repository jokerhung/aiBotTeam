"""A stand-in for Composio's backend: sessions, toolkits, connected accounts and sign-in links, enough for the app to be driven end to end."""
import json
import uuid

import httpx

GOOD_KEY = "ak_goodkey1234567890"


class FakeComposio:
    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.accounts: list[dict] = []
        self.calls: list[tuple[str, str]] = []
        self.keys_seen: set[str] = set()
        self.no_managed_auth = {"xero"}
        self.transport = httpx.MockTransport(self.handle)

    def activate(self, slug: str, user_id: str, alias=None, status="ACTIVE") -> dict:
        a = {"id": f"ca_{uuid.uuid4().hex[:10]}", "alias": alias, "status": status, "user_id": user_id, "toolkit": {"slug": slug}}
        self.accounts.append(a)
        return a

    def handle(self, req: httpx.Request) -> httpx.Response:
        path, method = req.url.path, req.method
        self.calls.append((method, path + ("?" + req.url.query.decode() if req.url.query else "")))
        key = req.headers.get("x-api-key", "")
        self.keys_seen.add(key)
        if key != GOOD_KEY:
            return httpx.Response(401, json={"message": "Invalid API key"})
        body = json.loads(req.content) if req.content else {}
        if path.endswith("/tool_router/session") and method == "POST":
            sid = f"trs_{uuid.uuid4().hex[:8]}"
            self.sessions[sid] = {"user_id": body["user_id"], "multi": body["multi_account"]}
            return httpx.Response(200, json={"session_id": sid, "mcp": {"type": "http", "url": f"https://backend.composio.dev/tool_router/v3/{sid}/mcp"},
                                             "config": {"user_id": body["user_id"], "multi_account": body["multi_account"]}})
        if "/tool_router/session/" in path and path.endswith("/link"):
            tk = body["toolkit"]
            if tk in self.no_managed_auth:
                return httpx.Response(400, json={"message": f"Composio does not manage auth for toolkit {tk} and no auth config is available"})
            user = self.sessions[path.split("/")[-2]]["user_id"]
            self.activate(tk, user, body.get("alias"), status="INITIATED")
            return httpx.Response(200, json={"redirect_url": f"https://connect.composio.dev/link/{uuid.uuid4().hex[:6]}"})
        if "/tool_router/session/" in path and method == "GET":
            sid = path.rsplit("/", 1)[-1]
            if sid not in self.sessions:
                return httpx.Response(404, json={"message": "no such session"})
            s = self.sessions[sid]
            return httpx.Response(200, json={"session_id": sid, "mcp": {"type": "http", "url": f"https://backend.composio.dev/tool_router/v3/{sid}/mcp"},
                                             "config": {"user_id": s["user_id"], "multi_account": s["multi"]}})
        if path.endswith("/connected_accounts") and method == "GET":
            q = req.url.params
            items = [a for a in self.accounts if a["user_id"] == q.get("user_ids") and (not q.get("toolkit_slugs") or a["toolkit"]["slug"] in q["toolkit_slugs"].split(","))]
            return httpx.Response(200, json={"items": items, "next_cursor": None})
        if "/connected_accounts/" in path and method == "DELETE":
            aid = path.rsplit("/", 1)[-1]
            self.accounts = [a for a in self.accounts if a["id"] != aid]
            return httpx.Response(200, json={"success": True})
        if path.endswith("/toolkits") and method == "GET":
            return httpx.Response(200, json={"items": [
                {"slug": "gmail", "name": "Gmail", "meta": {"description": "Read and send email", "logo": "https://logos.composio.dev/gmail.png"}},
                {"slug": "slack", "name": "Slack", "meta": {"description": "Post updates"}},
                {"slug": "xero", "name": "Xero", "meta": {"description": "Accounting"}}], "next_cursor": None})
        return httpx.Response(404, json={"message": f"unhandled {method} {path}"})
