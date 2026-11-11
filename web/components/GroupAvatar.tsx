import { Mascot } from "./Mascot";
import type { MemberInfo } from "@/lib/wire";

/** A room's face: up to three member avatars in an overlapped row, with a +N badge for the rest. */
export function GroupAvatar({ members, size = 44 }: { members: MemberInfo[]; size?: number }) {
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  const mini = Math.round(size * 0.55);
  const step = Math.round(mini * 0.62);
  return (
    <span className="relative flex shrink-0 items-center" style={{ width: step * (shown.length - 1) + mini + (extra > 0 ? 10 : 0), height: size }} aria-hidden>
      {shown.map((m, i) => (
        <span key={m.id} className="absolute" style={{ width: mini, height: mini, left: i * step, zIndex: i }}>
          <Mascot color={m.color as never} size={mini} />
        </span>
      ))}
      {extra > 0 && (
        <span className="absolute z-10 rounded-full bg-raised px-1 text-[9px] font-semibold leading-3 text-ink-secondary ring-1 ring-panel" style={{ left: shown.length * step + 2, bottom: size * 0.2 }}>+{extra}</span>
      )}
    </span>
  );
}
