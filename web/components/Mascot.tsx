import { useId } from "react";
import { CURSOR_FIT, CURSOR_PATH } from "@/lib/mascot-body";
import type { MausColor } from "@/lib/wire";

/** The bot avatar: the reference project's cursor body in the bot's identity colour, with a small face. */
export function Mascot({ color, size = 48, busy = false }: { color: MausColor; size?: number; busy?: boolean }) {
  const id = useId();
  const base = `var(--identity-${color})`;
  return (
    <svg width={size} height={size} viewBox="8 -8 214 244" aria-hidden="true" className="shrink-0" style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={base} />
          <stop offset="1" stopColor={base} />
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
        </linearGradient>
        <linearGradient id={`${id}-shade`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <g transform={CURSOR_FIT}>
        <path d={CURSOR_PATH} fill={base} />
        <path d={CURSOR_PATH} fill={`url(#${id}-shade)`} />
      </g>
      <g fill="#fff" className={busy ? "animate-pulse" : undefined}>
        <ellipse cx="88" cy="98" rx="9" ry="11" />
        <ellipse cx="124" cy="112" rx="9" ry="11" />
      </g>
      <path d="M82 134c14 9 30 12 46 6" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" />
    </svg>
  );
}
