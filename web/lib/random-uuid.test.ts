import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "./random-uuid";

afterEach(() => vi.unstubAllGlobals());
const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("UUID compatibility on HTTP LAN/Tailscale", () => {
  it("uses the native UUID API when available", () => {
    const id = "12345678-1234-4321-8765-123456789abc";
    vi.stubGlobal("crypto", { randomUUID: () => id });
    expect(randomUuid()).toBe(id);
  });

  it("creates distinct v4 IDs when only getRandomValues is available", () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const ids = Array.from({ length: 200 }, () => randomUuid());
    expect(ids.every((id) => v4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("also works in older environments without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(randomUuid()).toMatch(v4);
  });
});
