import type { MemberInfo, Routine } from "./wire";

const DAY = 86_400_000;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Split text into plain and @Name parts (the longest name wins), for the mirror layer behind the textarea. */
export function mentionParts(text: string, members: MemberInfo[]): { text: string; member?: MemberInfo }[] {
  if (!members.length) return [{ text }];
  const names = [...members].sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(`(?<![\\w@])@(${names.map((m) => escapeRe(m.name)).join("|")})(?![\\w])`, "gi");
  const out: { text: string; member?: MemberInfo }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], member: names.find((x) => x.name.toLowerCase() === m[1].toLowerCase()) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}


/** Weekday (0 = Monday) of an instant in a routine's own time zone. */
function weekdayIn(tz: string | null, ms: number): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz || undefined }).format(ms);
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
  } catch { return (new Date(ms).getDay() + 6) % 7; }
}

/** The times a routine will fire inside a window, projected from its next run (calendar display only). */
export function occurrences(r: Routine, from: number, to: number): number[] {
  if (!r.enabled || !r.nextRun) return [];
  const out: number[] = [];
  const first = r.nextRun;
  if (r.kind === "once") return first >= from && first < to ? [first] : [];
  if (r.kind === "interval" && r.everyMin) {
    const step = r.everyMin * 60_000;
    let t = first;
    if (t < from) t += Math.ceil((from - t) / step) * step;
    for (; t < to && out.length < 400; t += step) out.push(t);
    return out;
  }
  const days = r.days && r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6];
  for (let t = first; t < to && out.length < 60; t += DAY) if (t >= from && days.includes(weekdayIn(r.tz, t))) out.push(t);
  return out;
}

