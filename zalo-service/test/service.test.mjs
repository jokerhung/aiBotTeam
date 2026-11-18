import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { makeServer } from "../src/http.mjs";
import { ZaloService, normalize } from "../src/service.mjs";

const SECRET = "s3cret";
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "zalo-")); dirs.push(d); return d; };

/** A stand-in for zca-js: loginQR plays the QR events, login accepts cookies that say "good". */
class FakeApi {
  constructor(uid) { this.uid = uid; this.listener = new EventEmitter(); this.listener.start = () => { this.started = true; }; this.listener.stop = () => { this.stopped = true; }; this.sent = []; }
  getOwnId() { return this.uid; }
  async sendMessage(body, chat, type) { this.sent.push([body, chat, type]); return { message: { msgId: `m${this.sent.length}` } }; }
  async logout() { this.loggedOut = true; }
}
function fakeZalo({ uid = "111", script = ["gen", "scan", "got"] } = {}) {
  const made = [];
  const make = () => ({
    async loginQR(_o, cb) {
      const api = new FakeApi(uid);
      made.push(api);
      for (const step of script) {
        await new Promise((r) => setTimeout(r, 5));
        if (step === "gen") cb({ type: 0, data: { image: "QUJD" }, actions: { abort() {}, retry() {} } });
        if (step === "scan") cb({ type: 2, data: { display_name: "Minh" }, actions: {} });
        if (step === "got") cb({ type: 4, data: { cookie: [{ name: "good" }], imei: "i", userAgent: "ua" }, actions: null });
        if (step === "decline") { cb({ type: 3, data: { code: "x" }, actions: { abort() {} } }); throw new Error("declined"); }
      }
      return api;
    },
    async login(creds) {
      if (!JSON.stringify(creds).includes("good")) throw new Error("cookie refused");
      const api = new FakeApi(uid);
      made.push(api);
      return api;
    },
  });
  return { make, made };
}

const until = async (cond, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await cond(); if (r) return r; await new Promise((r2) => setTimeout(r2, 10)); } throw new Error("never happened"); };

async function boot({ dir = tmp(), z = fakeZalo(), allow = true } = {}) {
  const service = new ZaloService({ dir, makeZalo: z.make, retryMs: 10 });
  await service.start();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init.headers]); return new Response(JSON.stringify({ authenticated: allow }), { status: 200 }); };
  const server = makeServer({ service, secret: SECRET, api: "http://api", fetchImpl });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json() };
  };
  const internal = { "x-botteam-secret": SECRET };
  return { service, server, call, internal, dir, z, calls, close: async () => { await service.stop(); server.close(); } };
}

async function signIn(t) {
  const { loginId } = (await t.call("POST", "/login", { body: {} })).json;
  const done = await until(async () => { const r = (await t.call("GET", `/login/${loginId}`)).json; return r.state === "done" ? r : null; });
  return done.accountKey;
}

const text = (id, chat, content, extra = {}) => ({ type: 0, threadId: chat, isSelf: false, data: { msgId: id, uidFrom: chat, dName: "An", ts: "1", msgType: "webchat", content, ...extra } });

after(() => { /* temp dirs are small; the OS clears them */ });

test("a QR sign-in shows the code, then the name, then gives an account key, and saves the session privately", async () => {
  const t = await boot();
  const { loginId } = (await t.call("POST", "/login", { body: {} })).json;
  const seen = new Set();
  await until(async () => { const r = (await t.call("GET", `/login/${loginId}`)).json; seen.add(r.state); if (r.state === "qr") assert.ok(r.qr.startsWith("data:image/png;base64,QUJD")); return r.state === "done"; });
  assert.ok(seen.has("qr") || seen.has("scanned"));
  const done = (await t.call("GET", `/login/${loginId}`)).json;
  assert.equal(done.name, "Minh");
  assert.match(done.accountKey, /^[0-9a-f]{32}$/);
  const files = readdirSync(join(t.dir, "accounts"));
  assert.equal(files.length, 1);
  if (process.platform !== "win32") assert.equal(statSync(join(t.dir, "accounts", files[0])).mode & 0o777, 0o600);
  assert.equal((await t.call("GET", `/accounts/${done.accountKey}`, { headers: t.internal })).json.state, "connected");
  await t.close();
});

test("a declined sign-in ends as declined and makes no account", async () => {
  const t = await boot({ z: fakeZalo({ script: ["gen", "decline"] }) });
  const { loginId } = (await t.call("POST", "/login", { body: {} })).json;
  await until(async () => (await t.call("GET", `/login/${loginId}`)).json.state === "declined");
  assert.equal(t.service.accounts.size, 0);
  await t.close();
});

test("the browser side needs a browser BotTeam allows, JSON, and the same origin; the server side needs the secret", async () => {
  const closed = await boot({ allow: false });
  assert.equal((await closed.call("POST", "/login", { body: {} })).status, 401);
  assert.equal((await closed.call("GET", "/accounts/x", { headers: closed.internal })).status, 404, "the secret opens the door, the account is simply not there");
  assert.equal((await closed.call("GET", "/accounts/x")).status, 401);
  assert.equal((await closed.call("GET", "/accounts/x", { headers: { "x-botteam-secret": "wrong" } })).status, 401);
  await closed.close();

  const t = await boot();
  const noJson = await fetch(`http://127.0.0.1:${t.server.address().port}/login`, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
  assert.equal(noJson.status, 415, "a plain-text POST from another site is refused before anything starts");
  assert.equal((await t.call("POST", "/login", { body: {}, headers: { origin: "https://evil.example", "x-forwarded-host": "localhost:5299" } })).status, 401);
  const ok = await t.call("POST", "/login", { body: {}, headers: { origin: "http://localhost:5299", "x-forwarded-host": "localhost:5299", cookie: "botteam_session=abc" } });
  assert.equal(ok.status, 201);
  const [url, headers] = t.calls.at(-1);
  assert.equal(url, "http://api/api/auth/status");
  assert.equal(headers.cookie, "botteam_session=abc");
  assert.equal(headers["x-forwarded-host"], "localhost:5299", "BotTeam decides from the host the browser really used");
  assert.equal((await t.call("GET", "/accounts/x/events", { headers: t.internal })).status, 404);
  await t.close();
});

test("private messages (text and photos) are collected in order; groups, our own messages and other types are not mistaken for text", async () => {
  const t = await boot();
  const key = await signIn(t);
  const api = t.z.made.at(-1);
  api.listener.emit("message", text("1", "42", "xin chào"));
  api.listener.emit("message", { ...text("2", "g9", "to a group"), type: 1 });
  api.listener.emit("message", { ...text("3", "42", "mine"), isSelf: true });
  api.listener.emit("message", text("4", "42", { href: "https://cdn.example/p.jpg", title: "cap" }, { msgType: "chat.photo" }));
  api.listener.emit("message", text("5", "42", { x: 1 }, { msgType: "chat.sticker" }));
  const r = (await t.call("GET", `/accounts/${key}/events?after=0&timeout=1`, { headers: t.internal })).json;
  assert.deepEqual(r.events.map((e) => [e.id, e.kind, e.text, e.url]), [["1", "text", "xin chào", ""], ["4", "image", "cap", "https://cdn.example/p.jpg"], ["5", "other", "chat.sticker", ""]]);
  assert.equal(r.events[0].chatId, "42");
  const again = (await t.call("GET", `/accounts/${key}/events?after=${r.next}&timeout=0`, { headers: t.internal })).json;
  assert.deepEqual(again.events, [], "what was collected is not given twice");
  await t.close();
});

test("a long poll returns as soon as a message arrives", async () => {
  const t = await boot();
  const key = await signIn(t);
  const api = t.z.made.at(-1);
  setTimeout(() => api.listener.emit("message", text("7", "42", "late")), 50);
  const t0 = Date.now();
  const r = (await t.call("GET", `/accounts/${key}/events?after=0&timeout=5`, { headers: t.internal })).json;
  assert.equal(r.events[0].text, "late");
  assert.ok(Date.now() - t0 < 2000);
  await t.close();
});

test("sending checks the chat id and the text, and goes out as a private message", async () => {
  const t = await boot();
  const key = await signIn(t);
  const api = t.z.made.at(-1);
  const ok = await t.call("POST", `/accounts/${key}/send`, { headers: t.internal, body: { chatId: "42", text: "xin chào" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(api.sent[0], [{ msg: "xin chào" }, "42", 0]);
  for (const body of [{ chatId: "../x", text: "a" }, { chatId: "42", text: "" }, { chatId: "42", text: "a".repeat(2001) }]) {
    assert.equal((await t.call("POST", `/accounts/${key}/send`, { headers: t.internal, body })).status, 400);
  }
  await t.close();
});

test("a saved account signs in again at start; a refused session ends it and the server is told with a 401", async () => {
  const dir = tmp();
  const first = await boot({ dir });
  const key = await signIn(first);
  await first.close();

  const second = await boot({ dir });
  await until(() => second.service.info(key).state === "connected");
  assert.equal(second.z.made.length, 1, "it signed in again with the saved cookies");
  await second.close();

  const file = join(dir, "accounts", `${key}.json`);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.creds.cookie = [{ name: "bad" }];
  (await import("node:fs")).writeFileSync(file, JSON.stringify(saved));
  const third = await boot({ dir });
  await until(() => third.service.info(key).state === "loggedout");
  assert.equal((await third.call("GET", `/accounts/${key}/events?after=0`, { headers: third.internal })).status, 401);
  await third.close();
});

test("removing an account signs it out and deletes what was saved", async () => {
  const t = await boot();
  const key = await signIn(t);
  const api = t.z.made.at(-1);
  assert.equal((await t.call("DELETE", `/accounts/${key}`, { headers: t.internal })).status, 200);
  assert.ok(api.stopped && api.loggedOut);
  assert.equal(readdirSync(join(t.dir, "accounts")).length, 0);
  assert.equal((await t.call("GET", `/accounts/${key}`, { headers: t.internal })).status, 404);
  await t.close();
});

test("the same Zalo account signing in again keeps its key", async () => {
  const t = await boot();
  const a = await signIn(t);
  const b = await signIn(t);
  assert.equal(a, b);
  assert.equal(t.service.accounts.size, 1);
  await t.close();
});

test("normalize leaves out what it cannot read", () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize({ type: 0, isSelf: false, threadId: "1", data: {} }), null, "no message id");
  assert.equal(normalize(text("1", "5", { href: "file:///etc/passwd" }, { msgType: "chat.photo" })).kind, "other", "only http(s) photo links are passed on");
});
