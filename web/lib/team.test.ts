import { describe, expect, it } from "vitest";
import { mentionParts, occurrences } from "./team";
import type { MemberInfo, Routine } from "./wire";

const member = (id: string, name: string): MemberInfo => ({ id, name, color: "green", title: "" });

describe("mentionParts", () => {
  const members = [member("a", "Dev"), member("b", "Dev Lead")];
  it("finds @names and lets the longest name win", () => {
    const parts = mentionParts("hi @Dev Lead and @dev, ok", members);
    expect(parts.filter((p) => p.member).map((p) => p.member!.id)).toEqual(["b", "a"]);
    expect(parts.map((p) => p.text).join("")).toBe("hi @Dev Lead and @dev, ok");
  });
  it("ignores an @ inside a word or an unknown name", () => {
    expect(mentionParts("mail me@Dev or @Nobody", members).some((p) => p.member)).toBe(false);
  });
});

const base: Routine = {
  id: "r", name: "n", title: "n", prompt: "p", text: "p", targetKind: "bot", targetId: "b", botId: "b", kind: "interval", everyMin: 60, at: null, days: null,
  runAt: null, tz: "UTC", maxRunMin: 60, enabled: true, nextRun: 0, lastRun: null, schedule: "",
};

describe("occurrences", () => {
  const DAY = 86_400_000;
  it("steps an interval routine from its next run", () => {
    const t0 = Date.UTC(2026, 0, 5, 8, 0);
    expect(occurrences({ ...base, nextRun: t0 }, t0, t0 + 3 * 3_600_000)).toEqual([t0, t0 + 3_600_000, t0 + 2 * 3_600_000]);
  });
  it("shows nothing for a paused routine and one occurrence for a one-off", () => {
    expect(occurrences({ ...base, enabled: false, nextRun: 1 }, 0, DAY)).toEqual([]);
    expect(occurrences({ ...base, kind: "once", runAt: 5, nextRun: 5 }, 0, DAY)).toEqual([5]);
  });
  it("keeps to the chosen weekdays", () => {
    const monday = Date.UTC(2026, 0, 5, 9, 0); // a Monday
    const r: Routine = { ...base, kind: "weekly", at: "09:00", days: [0, 2], nextRun: monday };
    expect(occurrences(r, monday, monday + 7 * DAY)).toEqual([monday, monday + 2 * DAY]);
  });
});
