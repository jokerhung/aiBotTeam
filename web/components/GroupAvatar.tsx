import { Mascot } from "./Mascot";
import type { MemberInfo } from "@/lib/wire";

/** A room's face: up to three member avatars overlapped, with a +N badge for the rest. */
export function GroupAvatar({ members, size = 44 }: { members: MemberInfo[]; size?: number }) {
  const shown = members.slice(0, 3);
  const extra = members.length - shown.length;
  const mini = Math.round(size * 0.62);
  return (
    <span className="relative flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {shown.map((m, i) => (
        <span
          key={m.id}
          className="absolute rounded-full bg-panel ring-2 ring-panel"
          style={{ width: mini, height: mini, left: i * (mini * 0.42), top: i % 2 ? size - mini : 0, zIndex: i }}
        >
          <Mascot color={m.color as never} size={mini} />
        </span>
      ))}
      {extra > 0 && (
        <span className="absolute bottom-0 right-0 z-10 rounded-full bg-raised px-1 text-[10px] font-semibold leading-4 text-ink-secondary ring-2 ring-panel">+{extra}</span>
      )}
    </span>
  );
}
