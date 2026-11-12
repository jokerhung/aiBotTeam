import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyEvents } from "./event-proxy";

afterEach(() => vi.unstubAllGlobals());
const refused = () => new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });

describe("SSE proxy during API reload", () => {
  it("retries connection refusal and streams the response before it finishes", async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    const fetcher = vi.fn().mockRejectedValueOnce(refused()).mockRejectedValueOnce(refused())
      .mockResolvedValue(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher);
    const response = await proxyEvents(new Request("http://bot.example.com/api/events", {
      headers: { cookie: "botteam_session=test", "x-forwarded-host": "localhost:5299" },
    }), "http://127.0.0.1:8899", { retryMs: 1 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const forwarded = fetcher.mock.calls[2][1].headers as Headers;
    expect(forwarded.get("cookie")).toBe("botteam_session=test");
    expect(forwarded.get("x-forwarded-host")).toBe("bot.example.com");
    const reader = response.body!.getReader();
    streamController.enqueue(new TextEncoder().encode("data: live\n\n"));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: live\n\n");
    await reader.cancel();
  });

  it("preserves an authentication error without retrying it", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: "pairing required" }, { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    const response = await proxyEvents(new Request("http://example.com/api/events"), "http://127.0.0.1:8899");
    expect(response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("ends an established SSE stream cleanly when the backend restarts", async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const response = await proxyEvents(new Request("http://localhost/api/events"), "http://127.0.0.1:8899");
    const reader = response.body!.getReader();
    upstream.enqueue(new TextEncoder().encode("data: ready\n\n"));
    expect((await reader.read()).done).toBe(false);
    upstream.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
    expect((await reader.read()).done).toBe(true);
  });

  it("returns a retryable error if the API stays down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(refused()));
    const response = await proxyEvents(new Request("http://localhost/api/events"), "http://127.0.0.1:8899", { retryMs: 1, deadlineMs: 5 });
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("stops retrying when the browser disconnects", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockImplementation(() => { controller.abort(); return Promise.reject(refused()); });
    vi.stubGlobal("fetch", fetcher);
    const response = await proxyEvents(new Request("http://localhost/api/events", { signal: controller.signal }), "http://127.0.0.1:8899");
    expect(response.status).toBe(499);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("cancels the retry delay when the browser disconnects", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockRejectedValue(refused());
    vi.stubGlobal("fetch", fetcher);
    const pending = proxyEvents(new Request("http://localhost/api/events", { signal: controller.signal }), "http://127.0.0.1:8899", { retryMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
