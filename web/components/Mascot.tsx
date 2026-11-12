import { useId } from "react";
import type { MausColor } from "@/lib/wire";

/** Robot avatar requested in place of the reference app's cursor, tinted by bot identity. */
export function Mascot({ color, size = 48, busy = false }: { color: MausColor; size?: number; busy?: boolean }) {
  const id = useId();
  const base = `var(--identity-${color})`;
  const light = `color-mix(in srgb, ${base}, white 32%)`;
  const shade = `color-mix(in srgb, ${base}, #103047 30%)`;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" aria-hidden="true" data-bot-color={color} className="shrink-0">
      <defs>
        <linearGradient id={`${id}-body`} x1="24%" y1="0%" x2="68%" y2="100%">
          <stop offset="0" stopColor={light} />
          <stop offset="0.38" stopColor={base} />
          <stop offset="0.76" stopColor={base} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <linearGradient id={`${id}-ear`} x1="0%" y1="15%" x2="100%" y2="80%">
          <stop offset="0" stopColor={light} />
          <stop offset="0.5" stopColor={base} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <radialGradient id={`${id}-antenna`} cx="30%" cy="24%" r="80%">
          <stop offset="0" stopColor={light} />
          <stop offset="0.5" stopColor={base} />
          <stop offset="1" stopColor={shade} />
        </radialGradient>
        <radialGradient id={`${id}-screen`} cx="40%" cy="20%" r="95%">
          <stop offset="0" stopColor="#35404e" />
          <stop offset="0.7" stopColor="#252e3a" />
          <stop offset="1" stopColor="#1a222d" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0" stopColor={shade} />
          <stop offset="0.5" stopColor={base} />
          <stop offset="1" stopColor={light} />
        </linearGradient>
        <linearGradient id={`${id}-white`} x1="0%" y1="0%" x2="30%" y2="100%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#e3e9ed" />
        </linearGradient>
      </defs>
      <rect x="60" y="23" width="8" height="13" rx="4" fill={`url(#${id}-ear)`} />
      <circle cx="64" cy="18" r="10" fill={`url(#${id}-antenna)`} />
      <rect x="5" y="57" width="19" height="40" rx="13" fill={`url(#${id}-ear)`} />
      <rect x="104" y="57" width="19" height="40" rx="13" fill={`url(#${id}-ear)`} />
      <path d="M64 30C29 30 16 37 16 68v17c0 28 11 31 48 31s48-3 48-31V68c0-31-13-38-48-38Z" fill={`url(#${id}-body)`} />
      <path d="M27 47c6-10 21-12 37-12 15 0 28 1 35 7" fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="2" strokeLinecap="round" />
      <path d="M64 44c-29 0-39 4-39 27v12c0 20 7 23 39 23s39-3 39-23V71c0-23-10-27-39-27Z" fill={`url(#${id}-rim)`} />
      <path d="M64 47c-27 0-36 3-36 25v10c0 18 6 21 36 21s36-3 36-21V72c0-22-9-25-36-25Z" fill={`url(#${id}-screen)`} stroke="#121e2b" strokeWidth="1.2" />
      <path d="M37 54c6-4 15-5 27-5 11 0 20 1 26 4" fill="none" stroke="#fff" strokeOpacity="0.07" strokeWidth="1.2" strokeLinecap="round" />
      <g fill={`url(#${id}-white)`} className={busy ? "animate-pulse" : undefined}>
        <ellipse cx="47" cy="70" rx="6.3" ry="8" />
        <ellipse cx="81" cy="70" rx="6.3" ry="8" />
      </g>
      <path d="M55 86c5 5 13 5 18 0" fill="none" stroke={`url(#${id}-white)`} strokeWidth="3.7" strokeLinecap="round" />
    </svg>
  );
}
