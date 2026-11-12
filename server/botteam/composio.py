"""Connected apps through Composio (the way OpenMausBot does it: docs/composio.md there).

One Composio *project key* (ak_…) the person pastes once. With it the server keeps one Composio user for this installation and one Tool Router
Session (multi-account, explicit selection). The Session owns the connection state, the sign-in links and the MCP endpoint every bot reaches
the apps through. No provider token (Gmail, Slack, GitHub…) is ever stored here: Composio owns the connection lifecycle.

  catalog        GET  {v3}/toolkits                                  (a curated list when Composio cannot be read)
  status         GET  {v3.1}/tool_router/session/{id}/toolkits  +  GET {v3.1}/connected_accounts
  connect        POST {v3.1}/tool_router/session/{id}/link           -> a sign-in link, opened in the person's own browser
  disconnect     DELETE {v3.1}/connected_accounts/{id}?revoke_on_delete=true
  the bot's MCP  the Session's own MCP url, with the project key in `x-api-key`, kept as one custom MCP server (appId "composio")
"""
from __future__ import annotations

import os
import re
import uuid
from typing import Any, Optional
from urllib.parse import quote, urlsplit

import httpx

BACKEND = "https://backend.composio.dev"
ACCOUNT_ID = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")
MAX_ACCOUNTS = 5
MULTI_ACCOUNT = {"enable": True, "max_accounts_per_toolkit": MAX_ACCOUNTS, "require_explicit_selection": True}
USABLE = re.compile(r"^(active|initiated|initializing|pending)$", re.I)
NEEDS_AUTH_CONFIG = re.compile(r"does not manage auth|auth[_ ]?config", re.I)
ALIAS_REQUIRED = "Add an account alias so the existing connection is not replaced"
CURATED = [
    ("slack", "Slack", "Post updates and read channels"), ("github", "GitHub", "Issues, pull requests, and code"),
    ("gmail", "Gmail", "Read and send email"), ("googlecalendar", "Google Calendar", "Read and create events"),
    ("googlesheets", "Google Sheets", "Read and update spreadsheets"), ("googledocs", "Google Docs", "Read and write documents"),
    ("googledrive", "Google Drive", "Browse and manage files"), ("notion", "Notion", "Pages and databases"),
    ("linear", "Linear", "Issues and project tracking"), ("sentry", "Sentry", "Errors and alerts"),
    ("posthog", "PostHog", "Analytics, feature flags, experiments"), ("discord", "Discord", "Messages and channels"),
    ("twitter", "X (Twitter)", "Post and read on X"), ("reddit", "Reddit", "Browse and post"),
    ("jira", "Jira", "Issues and sprints"), ("asana", "Asana", "Tasks and projects"), ("hubspot", "HubSpot", "Contacts and deals"),
]


class ComposioError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def api_base() -> str:
    return (os.environ.get("BOTTEAM_COMPOSIO_API") or f"{BACKEND}/api/v3.1").rstrip("/")


def toolkit_base() -> str:
    return (os.environ.get("BOTTEAM_COMPOSIO_TOOLKITS_API") or f"{BACKEND}/api/v3").rstrip("/")


def slug_of(value: str) -> str:
    v = (value or "").strip().lower()
    return "twitter" if v == "x" else v


def trusted_url(value: str, what: str) -> str:
    """Composio's own hosts (or the explicit test backend's origin); any other address is refused."""
    try:
        u = urlsplit(value)
    except ValueError as e:
        raise ComposioError(f"Composio returned an untrusted {what}", 502) from e
    host = u.hostname or ""
    if u.scheme == "https" and (host == "composio.dev" or host.endswith(".composio.dev")):
        return value
    override = os.environ.get("BOTTEAM_COMPOSIO_API")
    if override:
        o = urlsplit(override)
        if (o.scheme, o.netloc) == (u.scheme, u.netloc) and u.scheme in ("http", "https"):
            return value
    raise ComposioError(f"Composio returned an untrusted {what}", 502)


def plan_link(toolkit: str, accounts: list[dict], alias: Optional[str]) -> dict:
    """How the next sign-in for one toolkit is made: a label is needed only beside a working account; an account that never
    finished or stopped working gives its label up and is removed first (`replace`)."""
    def may_be_active(a: dict) -> bool:
        return not a.get("id") or not a.get("status") or bool(re.match(r"^active$", a["status"], re.I))

    same = [a for a in accounts if alias and (a.get("alias") or "").strip().lower() == alias.lower()]
    if any(may_be_active(a) for a in same):
        raise ComposioError(f'Account alias "{alias}" is already in use for {toolkit}', 409)
    replace = [a["id"] for a in same if a.get("id")]
    usable = [a for a in accounts if a not in same and USABLE.match(a.get("status") or "")]
    if len(usable) >= MAX_ACCOUNTS:
        raise ComposioError(f"{toolkit} already has the maximum of {MAX_ACCOUNTS} accounts", 409)
    if alias or not accounts:
        return {"alias": alias, "replace": replace}
    if any(may_be_active(a) for a in accounts):
        raise ComposioError(ALIAS_REQUIRED, 400)
    return {"alias": f"bt-retry-{uuid.uuid4()}", "replace": replace}


def clean_alias(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ComposioError("Account alias must be text")
    alias = value.strip()
    if not alias:
        return None
    if len(alias) > 40 or not re.match(r"^[A-Za-z0-9][A-Za-z0-9 _.\-]*$", alias):
        raise ComposioError("An account label is up to 40 letters, numbers, spaces, dots, dashes or underscores")
    return alias


class Composio:
    def __init__(self, config, mcp, bus, transport: Optional[httpx.AsyncBaseTransport] = None) -> None:
        self.config, self.mcp, self.bus = config, mcp, bus
        self._transport = transport
        self._catalog: Optional[tuple[float, list[dict], str]] = None

    # ---- the key ------------------------------------------------------------------------------------------------------------
    def _saved(self) -> dict:
        return self.config.data.setdefault("composio", {})

    def key(self) -> Optional[str]:
        return (os.environ.get("COMPOSIO_API_KEY") or self.config.secret("composio:apiKey") or "").strip() or None

    def configured(self) -> bool:
        return self.key() is not None

    def public(self) -> dict:
        k = self.key()
        return {"configured": bool(k), "source": "environment" if os.environ.get("COMPOSIO_API_KEY") else ("saved" if k else None),
                "keyHint": f"{k[:3]}…{k[-4:]}" if k and len(k) > 8 else None}

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=30, transport=self._transport)

    def _headers(self, json: bool = False) -> dict:
        h = {"x-api-key": self.key() or ""}
        if json:
            h["content-type"] = "application/json"
        return h

    @staticmethod
    def _error(res: httpx.Response, fallback: str) -> str:
        try:
            body = res.json()
            err = body.get("error")
            msg = body.get("message") or (err.get("message") if isinstance(err, dict) else err)
            return str(msg or fallback)[:300]
        except Exception:
            return (res.text or "").strip()[:300] or fallback

    async def _call(self, method: str, url: str, *, json: Any = None, params: Any = None, timeout: float = 30) -> httpx.Response:
        if not self.key():
            raise ComposioError("Add a Composio project key first", 409)
        try:
            async with self._client() as c:
                return await c.request(method, url, headers=self._headers(json is not None), json=json, params=params, timeout=timeout)
        except httpx.HTTPError as e:
            raise ComposioError(f"Composio could not be reached: {type(e).__name__}", 502) from e

    # ---- the Session ----------------------------------------------------------------------------------------------------------
    async def _get_session(self, session_id: str) -> Optional[dict]:
        res = await self._call("GET", f"{api_base()}/tool_router/session/{quote(session_id)}", timeout=15)
        if res.status_code == 404:
            return None
        if res.status_code >= 400:
            raise ComposioError(self._error(res, f"Composio session: HTTP {res.status_code}"), 502)
        return self._parse_session(res.json())

    @staticmethod
    def _parse_session(body: dict) -> dict:
        mcp = (body.get("mcp") or {})
        if not body.get("session_id") or not mcp.get("url"):
            raise ComposioError("Composio returned an unreadable Session", 502)
        return {"session_id": body["session_id"], "mcp_url": trusted_url(mcp["url"], "Session MCP address"), "mcp_type": mcp.get("type", "http"),
                "user_id": (body.get("config") or {}).get("user_id"),
                "multi": bool(((body.get("config") or {}).get("multi_account") or {}).get("enable"))}

    async def _create_session(self, user_id: str) -> dict:
        res = await self._call("POST", f"{api_base()}/tool_router/session", json={
            "user_id": user_id, "multi_account": MULTI_ACCOUNT,
            "manage_connections": {"enable": True, "enable_wait_for_connections": True, "enable_connection_removal": True}})
        if res.status_code >= 400:
            raise ComposioError(self._error(res, f"Composio rejected this key (HTTP {res.status_code})"), 400 if res.status_code in (401, 403) else 502)
        return self._parse_session(res.json())

    async def ensure_session(self) -> dict:
        """The saved Session while it still exists and is multi-account; otherwise a new one for the same Composio user (every connection
        belongs to the user, so nothing is lost)."""
        saved = self._saved()
        user_id = saved.get("userId") or f"botteam_{uuid.uuid4()}"
        if saved.get("sessionId"):
            existing = await self._get_session(saved["sessionId"])
            if existing and existing["multi"]:
                existing["user_id"] = existing.get("user_id") or user_id
                return existing
            if existing and existing.get("user_id"):
                user_id = existing["user_id"]
        session = await self._create_session(user_id)
        saved.update(userId=session.get("user_id") or user_id, sessionId=session["session_id"])
        self.config.save()
        session["user_id"] = saved["userId"]
        return session

    async def set_key(self, key: str) -> dict:
        key = (key or "").strip()
        if not key:
            raise ComposioError("Enter a Composio project API key")
        if not key.startswith("ak_"):
            raise ComposioError("Composio project API keys start with ak_ (the ck_ key on the personal page is a different key)")
        previous, previous_key = dict(self._saved()), self.config.secret("composio:apiKey")
        same = previous_key == key
        self.config.data["composio"] = {"userId": previous.get("userId") if same else None, "sessionId": previous.get("sessionId") if same else None}
        self.config.set_secret("composio:apiKey", key)
        self._catalog = None
        try:
            session = await self.ensure_session()  # validates the key: Composio refuses a wrong one
        except ComposioError:
            self.config.data["composio"] = previous
            self.config.set_secret("composio:apiKey", previous_key)
            raise
        await self.sync_mcp(session)
        return self.public()

    async def clear_key(self) -> None:
        self.config.data.pop("composio", None)
        self.config.set_secret("composio:apiKey", None)
        self._catalog = None
        await self._drop_mcp()

    # ---- the bot's MCP server ---------------------------------------------------------------------------------------------------
    async def _mcp_id(self) -> Optional[str]:
        return next((i for i, s in await self.mcp.list() if s.get("appId") == "composio"), None)

    async def sync_mcp(self, session: Optional[dict] = None) -> Optional[str]:
        """One custom MCP server, "Composio": the Session's endpoint with the project key in a header (kept like any secret of a server)."""
        if not self.configured():
            await self._drop_mcp()
            return None
        session = session or await self.ensure_session()
        spec = {"name": "Composio", "transport": "sse" if session.get("mcp_type") == "sse" else "http", "url": session["mcp_url"], "appId": "composio",
                "headers": {"x-api-key": self.key()}}
        sid = await self._mcp_id()
        if sid:
            await self.mcp.update(sid, spec)
            return sid
        sid, _ = await self.mcp.create(spec)
        return sid

    async def _drop_mcp(self) -> None:
        sid = await self._mcp_id()
        if sid:
            await self.mcp.delete(sid)

    # ---- the catalog ------------------------------------------------------------------------------------------------------------
    async def catalog(self) -> tuple[list[dict], str]:
        import time

        if self._catalog and time.time() - self._catalog[0] < 600:
            return self._catalog[1], self._catalog[2]
        cards: list[dict] = []
        if self.configured():
            cursor = None
            try:
                for _ in range(10):
                    params = {"limit": "500", "sort_by": "usage"}
                    if cursor:
                        params["cursor"] = cursor
                    res = await self._call("GET", f"{toolkit_base()}/toolkits", params=params, timeout=15)
                    if res.status_code >= 400:
                        break
                    body = res.json()
                    for t in body.get("items") or body.get("data") or []:
                        slug = slug_of(str(t.get("slug") or t.get("key") or t.get("name") or ""))
                        if slug and all(c["slug"] != slug for c in cards):
                            meta = t.get("meta") or {}
                            cards.append({"slug": slug, "label": t.get("name") or slug, "blurb": str(meta.get("description") or t.get("description") or "")[:90],
                                          "logo": meta.get("logo") or t.get("logo"), "noAuth": t.get("no_auth") is True})
                    cursor = (body.get("next_cursor") or "").strip() or None
                    if not cursor:
                        break
            except (ComposioError, ValueError):
                cards = []
        source = "api" if cards else "curated"
        if not cards:
            cards = [{"slug": s, "label": n, "blurb": b, "logo": None, "noAuth": False} for s, n, b in CURATED]
        if source == "api":
            import time as _t

            self._catalog = (_t.time(), cards, source)
        return cards, source

    # ---- connections --------------------------------------------------------------------------------------------------------------
    async def accounts(self, user_id: str, slugs: list[str]) -> list[dict]:
        out: list[dict] = []
        cursor, seen = None, set()
        for _ in range(100):
            params: dict[str, str] = {"limit": "50", "order_by": "updated_at", "order_direction": "desc", "user_ids": user_id}
            if slugs:
                params["toolkit_slugs"] = ",".join(slugs)
            if cursor:
                params["cursor"] = cursor
            res = await self._call("GET", f"{api_base()}/connected_accounts", params=params, timeout=15)
            if res.status_code >= 400:
                raise ComposioError(self._error(res, f"Composio accounts: HTTP {res.status_code}"), 502)
            body = res.json()
            out.extend(body.get("items") or [])
            cursor = body.get("next_cursor") or None
            if not cursor or cursor in seen:
                break
            seen.add(cursor)
        return out

    @staticmethod
    def _summ(a: dict) -> dict:
        return {"id": a.get("id"), "alias": a.get("alias"), "status": str(a.get("status") or "ACTIVE").upper()}

    async def status(self, slugs: Optional[list[str]] = None) -> dict[str, dict]:
        """slug -> {connected, pending, status, accounts[{id, alias, status}]} for the toolkits asked (every connected one when none)."""
        session = await self.ensure_session()
        wanted = [slug_of(s) for s in (slugs or [])]
        accounts = await self.accounts(session["user_id"], wanted)
        by: dict[str, list[dict]] = {}
        for a in accounts:
            s = slug_of(((a.get("toolkit") or {}).get("slug")) or "")
            if s and (not wanted or s in wanted) and a.get("id") and ACCOUNT_ID.match(a["id"]):
                by.setdefault(s, []).append(self._summ(a))
        out = {}
        for s, lst in by.items():
            out[s] = {"connected": any(x["status"] == "ACTIVE" for x in lst),
                      "pending": any(x["status"] in ("INITIATED", "INITIALIZING", "PENDING") for x in lst),
                      "status": "ACTIVE" if any(x["status"] == "ACTIVE" for x in lst) else lst[0]["status"], "accounts": lst}
        for s in wanted:
            out.setdefault(s, {"connected": False, "pending": False, "status": "NONE", "accounts": []})
        return out

    async def authorize(self, slug: str, alias: Any = None) -> dict:
        toolkit = slug_of(slug)
        if not re.match(r"^[a-z0-9_\-]{1,60}$", toolkit):
            raise ComposioError("Unknown app", 404)
        label = clean_alias(alias)
        session = await self.ensure_session()
        try:
            existing = [a for a in await self.accounts(session["user_id"], [toolkit]) if slug_of(((a.get("toolkit") or {}).get("slug")) or "") == toolkit]
        except ComposioError:
            existing = []
        plan = plan_link(toolkit, [self._summ(a) | {"id": a.get("id")} for a in existing], label)
        for rid in plan["replace"]:
            await self._delete_account(rid)
        body: dict[str, Any] = {"toolkit": toolkit}
        if plan["alias"]:
            body["alias"] = plan["alias"]
        res = await self._call("POST", f"{api_base()}/tool_router/session/{quote(session['session_id'])}/link", json=body)
        if res.status_code >= 400:
            msg = self._error(res, f"Composio authorization: HTTP {res.status_code}")
            if NEEDS_AUTH_CONFIG.search(msg):
                raise ComposioError(f"{toolkit} has no Composio-managed sign-in. In the Composio dashboard create an auth config for it with your own "
                                    "OAuth app (Auth Configs → Create), keep it enabled, then connect again.", 409)
            raise ComposioError(msg, 502)
        url = (res.json() or {}).get("redirect_url")
        if not url:
            raise ComposioError(f"Composio returned no authorization link for {toolkit}", 502)
        return {"url": trusted_url(url, "authorization link")}

    async def _delete_account(self, account_id: str) -> None:
        res = await self._call("DELETE", f"{api_base()}/connected_accounts/{quote(account_id)}", params={"revoke_on_delete": "true"})
        if res.status_code >= 400 and res.status_code != 404:
            raise ComposioError(self._error(res, f"Composio disconnect: HTTP {res.status_code}"), 502)

    async def remove_account(self, slug: str, account_id: str) -> dict:
        """Disconnect exactly one account, after proving it belongs to this user and this toolkit."""
        if not ACCOUNT_ID.match(account_id or ""):
            raise ComposioError("Invalid connected-account ID")
        toolkit = slug_of(slug)
        session = await self.ensure_session()
        owned = [a for a in await self.accounts(session["user_id"], [toolkit]) if a.get("id") == account_id and slug_of(((a.get("toolkit") or {}).get("slug")) or "") == toolkit]
        if not owned:
            return {"removed": 0}
        await self._delete_account(account_id)
        return {"removed": 1}
