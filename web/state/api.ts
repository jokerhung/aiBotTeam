export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 30_000, headers, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: { "content-type": "application/json", ...(headers as Record<string, string>) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as { detail?: unknown }).detail;
    throw new ApiError(typeof detail === "string" ? detail : `${res.status} ${res.statusText}`, res.status, body);
  }
  return body as T;
}
