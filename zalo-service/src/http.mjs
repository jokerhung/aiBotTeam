// The HTTP face of the Zalo service. Two kinds of caller:
//   the BotTeam server  -> /accounts/*  (needs the shared secret in `x-botteam-secret`; the browser never has it)
//   the browser         -> /login/*     (reached through the Next.js proxy at /zalo-api; allowed only for a browser BotTeam itself would let in)
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { ServiceError } from "./service.mjs";

const BODY_MAX = 64 * 1024;
const WAIT_MAX = 30;

const same = (a, b) => {
  const x = Buffer.from(String(a ?? "")), y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
};

async function readJson(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > BODY_MAX) throw new ServiceError("the request is too large", 413);
    chunks.push(c);
  }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ServiceError("the body is not JSON", 400); }
}

/** @param {{service: import("./service.mjs").ZaloService, secret: string, api: string, fetchImpl?: typeof fetch}} o */
export function makeServer({ service, secret, api, fetchImpl = fetch }) {
  /** Ask BotTeam itself whether this browser may use the app (a paired browser, or one it lets in directly). Anything unclear is a no. */
  async function browserAllowed(req) {
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
    const origin = req.headers.origin;
    if (origin) { // a page of another site must not drive the sign-in
      try { if (new URL(origin).host !== host) return false; } catch { return false; }
    }
    try {
      const r = await fetchImpl(`${api}/api/auth/status`, { headers: { cookie: String(req.headers.cookie || ""), "x-forwarded-host": host }, signal: AbortSignal.timeout(5000) });
      return r.ok && (await r.json()).authenticated === true;
    } catch {
      return false;
    }
  }

  const handler = async (req, res) => {
    const send = (status, body) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
      res.end(text);
    };
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const m = req.method ?? "GET";

      if (path === "/health" && m === "GET") return send(200, { ok: true, accounts: service.accounts.size });

      if (path === "/login" || path.startsWith("/login/")) {
        if (m !== "GET" && !String(req.headers["content-type"] || "").startsWith("application/json")) return send(415, { error: "send application/json" });
        if (!(await browserAllowed(req))) return send(401, { error: "open BotTeam in this browser first (pair it), then try again" });
        if (path === "/login" && m === "POST") return send(201, service.startLogin());
        const id = path.split("/")[2];
        if (m === "GET") return send(200, service.login(id));
        if (m === "DELETE") { service.cancelLogin(id); return send(200, { ok: true }); }
        return send(405, { error: "method not allowed" });
      }

      if (path.startsWith("/accounts/")) {
        if (!same(req.headers["x-botteam-secret"], secret)) return send(401, { error: "not allowed" });
        const [, , key, what] = path.split("/");
        if (!what && m === "GET") return send(200, service.info(key));
        if (!what && m === "DELETE") { await service.remove(key); return send(200, { ok: true }); }
        if (what === "events" && m === "GET") {
          const after = Number(url.searchParams.get("after")) || 0;
          const wait = Math.min(Math.max(Number(url.searchParams.get("timeout")) || 0, 0), WAIT_MAX) * 1000;
          return send(200, await service.events(key, after, wait));
        }
        if (what === "send" && m === "POST") {
          const b = await readJson(req);
          return send(200, await service.send(key, b.chatId, b.text));
        }
      }
      return send(404, { error: "not found" });
    } catch (e) {
      if (e instanceof ServiceError) return send(e.status, { error: e.message });
      return send(500, { error: "internal error" });
    }
  };
  return createServer(handler);
}
