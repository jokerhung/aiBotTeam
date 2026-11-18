// The Zalo accounts this service holds: QR sign-in, the saved session of each account, the messages people send it, and sending text back.
// It speaks to Zalo only through zca-js (an unofficial library that behaves like Zalo Web). `makeZalo` is injected so tests run without Zalo.
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_EVENTS = 500; // messages kept per account for the server to collect
export const MAX_ACCOUNTS = 5;
export const MAX_LOGINS = 3;
export const LOGIN_TTL = 5 * 60_000;
export const MAX_QR_RETRIES = 4;
export const TEXT_MAX = 2000;

export class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** One message from zca-js as the server reads it, or null for anything it does not handle (a group, our own message). */
export function normalize(msg) {
  if (!msg || msg.isSelf || msg.type !== 0 /* ThreadType.User */) return null;
  const d = msg.data ?? {};
  const base = { id: String(d.msgId ?? ""), chatId: String(msg.threadId ?? ""), userId: String(d.uidFrom ?? ""), userName: String(d.dName ?? ""), ts: Number(d.ts) || Date.now() };
  if (!base.id || !base.chatId) return null;
  if (typeof d.content === "string") return { ...base, kind: "text", text: d.content, url: "" };
  const c = d.content && typeof d.content === "object" ? d.content : {};
  if (String(d.msgType ?? "").includes("photo") && typeof c.href === "string" && /^https?:\/\//.test(c.href)) {
    return { ...base, kind: "image", text: typeof c.title === "string" ? c.title : "", url: c.href };
  }
  return { ...base, kind: "other", text: String(d.msgType ?? ""), url: "" };
}

const asImage = (b64) => (!b64 ? "" : String(b64).startsWith("data:") ? String(b64) : `data:image/png;base64,${b64}`);

export class ZaloService {
  /** @param {{dir: string, makeZalo: () => {loginQR: Function, login: Function}, log?: (m: string) => void, retryMs?: number}} o */
  constructor({ dir, makeZalo, log = () => {}, retryMs = 2000 }) {
    this.retryMs = retryMs;
    this.dir = join(dir, "accounts");
    this.makeZalo = makeZalo;
    this.log = log;
    mkdirSync(this.dir, { recursive: true });
    this.accounts = new Map(); // key -> account
    this.logins = new Map(); // id -> sign-in in progress
    this.seq = Date.now(); // increases across restarts, so a cursor from before a restart is never ahead
  }

  // ---- accounts -----------------------------------------------------------------------------------------------------------------------
  async start() {
    for (const f of readdirSync(this.dir).filter((n) => n.endsWith(".json"))) {
      try {
        const saved = JSON.parse(readFileSync(join(this.dir, f), "utf8"));
        if (saved?.key && saved?.creds) this._boot(saved);
      } catch (e) {
        this.log(`skipped ${f}: ${e.message}`);
      }
    }
  }

  _account(saved) {
    const a = { key: saved.key, uid: saved.uid ?? "", name: saved.name ?? "", creds: saved.creds, state: "connecting", error: "", api: null, events: [], waiters: new Set() };
    this.accounts.set(a.key, a);
    return a;
  }

  _save(a) {
    const file = join(this.dir, `${a.key}.json`);
    writeFileSync(file, JSON.stringify({ key: a.key, uid: a.uid, name: a.name, creds: a.creds }), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* not on every system */ }
  }

  /** An account saved earlier: sign in again with its cookies. A refused session ends it ("loggedout"), anything else is retried. */
  _boot(saved) {
    const a = this._account(saved);
    const attempt = async (n) => {
      if (a.removed) return;
      try {
        const api = await this.makeZalo().login(a.creds);
        this._attach(a, api);
      } catch (e) {
        a.error = String(e?.message ?? e).slice(0, 200);
        if (n >= 3) { a.state = "loggedout"; this.log(`account ${a.key}: sign-in refused (${a.error})`); return; }
        a.state = "connecting";
        a.retry = setTimeout(() => void attempt(n + 1), this.retryMs * (n + 1));
        a.retry.unref?.();
      }
    };
    void attempt(0);
    return a;
  }

  _attach(a, api) {
    a.api = api;
    try { a.uid = String(api.getOwnId?.() ?? a.uid); } catch { /* keep what was saved */ }
    a.state = "connected";
    a.error = "";
    const l = api.listener;
    l.on("message", (m) => this._incoming(a, m));
    l.on("connected", () => { a.state = "connected"; });
    l.on("disconnected", () => { if (a.state === "connected") a.state = "connecting"; });
    l.on("closed", (code) => { if (!a.removed) { a.state = code === 3000 ? "duplicate" : "connecting"; } });
    l.on("error", (e) => { a.error = String(e?.message ?? e).slice(0, 200); });
    l.start({ retryOnClose: true });
  }

  _incoming(a, raw) {
    const ev = normalize(raw);
    if (!ev) return;
    a.events.push({ ...ev, seq: ++this.seq });
    if (a.events.length > MAX_EVENTS) a.events.splice(0, a.events.length - MAX_EVENTS);
    for (const w of [...a.waiters]) w();
  }

  account(key) {
    const a = this.accounts.get(key);
    if (!a) throw new ServiceError("no such account", 404);
    return a;
  }

  info(key) {
    const a = this.account(key);
    return { key: a.key, uid: a.uid, name: a.name, state: a.state, error: a.error };
  }

  /** What arrived after `after`, waiting up to `waitMs` when there is nothing yet. A session Zalo refused answers 401 so the server stops asking. */
  async events(key, after, waitMs) {
    const a = this.account(key);
    if (a.state === "loggedout") throw new ServiceError("Zalo ended this session: sign in again with the QR code", 401);
    const pick = () => a.events.filter((e) => e.seq > after);
    let got = pick();
    if (!got.length && waitMs > 0) {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(t); a.waiters.delete(done); resolve(); };
        const t = setTimeout(done, waitMs);
        a.waiters.add(done);
      });
      got = pick();
    }
    const next = got.length ? got[got.length - 1].seq : Math.max(after, 0);
    return { events: got, next: String(next), state: a.state };
  }

  async send(key, chatId, text) {
    const a = this.account(key);
    if (!/^\d{1,30}$/.test(String(chatId))) throw new ServiceError("chatId must be a Zalo user id", 400);
    const body = String(text ?? "");
    if (!body.trim() || body.length > TEXT_MAX) throw new ServiceError(`the text is 1 to ${TEXT_MAX} characters`, 400);
    if (!a.api || a.state !== "connected") throw new ServiceError("this account is not connected right now", 503);
    const r = await a.api.sendMessage({ msg: body }, String(chatId), 0 /* ThreadType.User */);
    return { messageId: String(r?.message?.msgId ?? "") };
  }

  async remove(key) {
    const a = this.account(key);
    a.removed = true;
    clearTimeout(a.retry);
    for (const w of [...a.waiters]) w();
    try { a.api?.listener?.stop(); } catch { /* already closed */ }
    try { await a.api?.logout?.(); } catch { /* the session may already be gone */ }
    this.accounts.delete(key);
    rmSync(join(this.dir, `${key}.json`), { force: true });
  }

  async stop() {
    for (const a of this.accounts.values()) {
      clearTimeout(a.retry);
      try { a.api?.listener?.stop(); } catch { /* ignore */ }
    }
    for (const l of this.logins.values()) l.abort?.();
  }

  // ---- QR sign-in -----------------------------------------------------------------------------------------------------------------------
  _sweepLogins() {
    const now = Date.now();
    for (const [id, l] of this.logins) if (now - l.at > LOGIN_TTL) { l.abort?.(); this.logins.delete(id); }
  }

  startLogin() {
    this._sweepLogins();
    if (this.logins.size >= MAX_LOGINS) throw new ServiceError("too many sign-ins at once; finish or cancel one", 429);
    if (this.accounts.size >= MAX_ACCOUNTS) throw new ServiceError(`at most ${MAX_ACCOUNTS} Zalo accounts`, 409);
    const id = randomUUID();
    const s = { id, state: "starting", qr: "", name: "", accountKey: "", error: "", at: Date.now(), retries: 0, abort: null };
    this.logins.set(id, s);
    const cb = (e) => {
      switch (e.type) {
        case 0: // QRCodeGenerated
          s.state = "qr"; s.qr = asImage(e.data?.image); s.abort = e.actions?.abort ?? null; break;
        case 1: // QRCodeExpired: a new code, a few times
          if (s.retries++ < MAX_QR_RETRIES) { s.state = "starting"; e.actions?.retry?.(); } else { s.state = "expired"; e.actions?.abort?.(); }
          break;
        case 2: // QRCodeScanned
          s.state = "scanned"; s.name = String(e.data?.display_name ?? ""); break;
        case 3: // QRCodeDeclined
          s.state = "declined"; e.actions?.abort?.(); break;
        case 4: // GotLoginInfo
          s.creds = e.data; break;
        default: break;
      }
    };
    this.makeZalo().loginQR({}, cb).then((api) => {
      if (!s.creds) throw new Error("Zalo gave no session");
      const uid = String(api.getOwnId?.() ?? "");
      const same = [...this.accounts.values()].find((a) => uid && a.uid === uid);
      const a = same ?? this._account({ key: randomUUID().replace(/-/g, ""), uid, name: s.name, creds: s.creds });
      a.creds = s.creds;
      a.name = s.name || a.name;
      if (same) { try { same.api?.listener?.stop(); } catch { /* replaced */ } }
      this._attach(a, api);
      this._save(a);
      s.accountKey = a.key;
      s.state = "done";
    }).catch((e) => {
      if (s.state === "declined" || s.state === "expired") return;
      s.state = "error";
      s.error = String(e?.message ?? e).slice(0, 200);
    });
    return { loginId: id };
  }

  login(id) {
    this._sweepLogins();
    const s = this.logins.get(id);
    if (!s) throw new ServiceError("no such sign-in (it may have expired)", 404);
    return { state: s.state, qr: s.state === "qr" ? s.qr : "", name: s.name, accountKey: s.state === "done" ? s.accountKey : "", error: s.error };
  }

  cancelLogin(id) {
    const s = this.logins.get(id);
    if (s) { s.abort?.(); this.logins.delete(id); }
  }
}

export const hasSavedAccounts = (dir) => existsSync(join(dir, "accounts")) && readdirSync(join(dir, "accounts")).some((n) => n.endsWith(".json"));
