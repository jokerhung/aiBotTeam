import { setTimeout as delay } from "node:timers/promises";

/** A dev reload briefly closes the API socket. Wait for it without buffering SSE data. */
export async function proxyEvents(request: Request, backend: string, { retryMs = 250, deadlineMs = 15_000 } = {}) {
  const deadline = Date.now() + deadlineMs;
  const headers = new Headers({ accept: "text/event-stream" });
  headers.set("x-forwarded-host", request.headers.get("host") ?? new URL(request.url).host);
  for (const name of ["cookie", "last-event-id"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  while (!request.signal.aborted) {
    try {
      const upstream = await fetch(`${backend.replace(/\/+$/, "")}/api/events`, { headers, signal: request.signal, cache: "no-store" });
      const responseHeaders = new Headers(upstream.headers);
      for (const name of ["connection", "transfer-encoding", "content-length", "content-encoding"]) responseHeaders.delete(name);
      const reader = upstream.body?.getReader();
      const body = reader ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          } catch {
            // A reload can also close an established upstream connection.
            // End SSE so EventSource reconnects and rehydrates after restart.
            controller.close();
          }
        },
        async cancel(reason) { await reader.cancel(reason).catch(() => {}); },
      }) : null;
      return new Response(body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      if (request.signal.aborted) break;
      const code = (error as { cause?: { code?: string } }).cause?.code;
      if (!["ECONNREFUSED", "ECONNRESET", "EPIPE"].includes(code ?? "")) throw error;
      if (Date.now() >= deadline) {
        return Response.json({ detail: "Backend is unavailable. Reconnecting shortly." }, { status: 503, headers: { "Retry-After": "1" } });
      }
      try {
        await delay(Math.min(retryMs, Math.max(1, deadline - Date.now())), undefined, { signal: request.signal });
      } catch {
        if (!request.signal.aborted) throw error;
      }
    }
  }
  return new Response(null, { status: 499 });
}
