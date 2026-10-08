import type { ReactNode } from "react";

/* All art is stroke-only line drawing. Colors come from the theme tokens in globals.css. */

type SvgProps = { className?: string; title?: string };

const base = {
  fill: "none",
  strokeWidth: 3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Svg({ viewBox, className, title, children }: SvgProps & { viewBox: string; children: ReactNode }) {
  return (
    <svg
      viewBox={viewBox}
      className={className}
      {...base}
      stroke="currentColor"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {children}
    </svg>
  );
}

/** Tunnel the mascot: a little brick archway with a face and a dashed trail running through it. */
export function Mascot({ className, title }: SvgProps) {
  return (
    <Svg viewBox="0 0 180 150" className={className} title={title}>
      {/* trail running through the tunnel */}
      <path d="M4 128 H176" className="flow" stroke="var(--coral)" />
      {/* arch */}
      <path d="M32 128 V76 a58 58 0 0 1 116 0 V128" stroke="var(--ink)" />
      <path d="M54 128 V80 a36 36 0 0 1 72 0 V128" stroke="var(--lilac)" />
      {/* bricks */}
      <path d="M32 104 H54 M126 104 H148 M32 80 H44 M136 80 H148 M48 40 L56 52 M132 40 L124 52 M90 18 V30" stroke="var(--butter)" />
      {/* face */}
      <g className="blink">
        <path d="M76 92 v6" stroke="var(--ink)" />
        <path d="M104 92 v6" stroke="var(--ink)" />
      </g>
      <path d="M82 108 q8 8 16 0" stroke="var(--ink)" />
      <path d="M66 106 h6 M108 106 h6" stroke="var(--coral)" />
      {/* sparkles */}
      <path d="M18 34 v12 M12 40 h12" className="twinkle" stroke="var(--mint)" />
      <path d="M160 24 v10 M155 29 h10" className="twinkle" stroke="var(--butter)" style={{ animationDelay: "1s" }} />
      <circle cx="150" cy="58" r="3" className="twinkle" stroke="var(--coral)" style={{ animationDelay: "2s" }} />
    </Svg>
  );
}

export function PhoneIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <rect x="18" y="6" width="28" height="52" rx="7" stroke="var(--ink)" />
      <path d="M28 12 h8" stroke="var(--ink)" />
      <path d="M26 30 h12 M26 38 h8" stroke="var(--coral)" />
      <circle cx="32" cy="50" r="2" stroke="var(--ink)" />
    </Svg>
  );
}

export function LaptopIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <rect x="12" y="14" width="40" height="28" rx="4" stroke="var(--ink)" />
      <path d="M6 50 h52 l-4 -8 H10 z" stroke="var(--ink)" />
      <path d="M22 24 l6 5 -6 5 M32 34 h8" stroke="var(--mint)" />
    </Svg>
  );
}

export function TunnelIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <path d="M8 54 V32 a24 24 0 0 1 48 0 V54" stroke="var(--ink)" />
      <path d="M20 54 V34 a12 12 0 0 1 24 0 V54" stroke="var(--lilac)" />
      <path d="M4 54 H60" stroke="var(--coral)" strokeDasharray="4 5" />
    </Svg>
  );
}

export function LockIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <rect x="14" y="28" width="36" height="28" rx="7" stroke="var(--ink)" />
      <path d="M22 28 v-7 a10 10 0 0 1 20 0 v7" stroke="var(--lilac)" />
      <circle cx="32" cy="40" r="3" stroke="var(--coral)" />
      <path d="M32 43 v6" stroke="var(--coral)" />
    </Svg>
  );
}

export function CloudIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <path d="M18 46 a12 12 0 0 1 -1 -24 a15 15 0 0 1 29 3 a10 10 0 0 1 0 21 z" stroke="var(--ink)" />
      <path d="M26 36 q3 3 6 0 M24 31 v2 M40 31 v2" stroke="var(--mint)" />
    </Svg>
  );
}

export function ClockIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <circle cx="32" cy="32" r="22" stroke="var(--ink)" />
      <path d="M32 18 v14 l10 6" stroke="var(--butter)" />
    </Svg>
  );
}

export function FileIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <path d="M16 6 h22 l12 12 v40 H16 z" stroke="var(--ink)" />
      <path d="M38 6 v12 h12" stroke="var(--ink)" />
      <path d="M24 32 h16 M24 40 h16 M24 48 h10" stroke="var(--lilac)" />
    </Svg>
  );
}

export function TextIcon({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 64 64" className={className}>
      <path d="M8 12 h48 a4 4 0 0 1 4 4 v26 a4 4 0 0 1 -4 4 H30 l-12 10 v-10 H8 a4 4 0 0 1 -4 -4 V16 a4 4 0 0 1 4 -4 z" stroke="var(--ink)" />
      <path d="M16 24 h32 M16 33 h20" stroke="var(--coral)" />
    </Svg>
  );
}

export function ArrowDown({ className }: SvgProps) {
  return (
    <Svg viewBox="0 0 24 24" className={className}>
      <path d="M12 4 v15 M6 13 l6 6 6 -6" />
    </Svg>
  );
}

/** Faint scattered doodles behind everything; fixed so they stay put while content scrolls. */
export function Doodles() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-60">
      <svg className="absolute left-[6%] top-[12%] h-8 w-8 twinkle" viewBox="0 0 24 24" {...base} stroke="var(--butter)">
        <path d="M12 3 v18 M3 12 h18 M6 6 l12 12 M18 6 L6 18" />
      </svg>
      <svg className="absolute right-[8%] top-[20%] h-10 w-10 twinkle" viewBox="0 0 24 24" {...base} stroke="var(--mint)" style={{ animationDelay: "1.2s" }}>
        <path d="M12 4 v16 M4 12 h16" />
      </svg>
      <svg className="absolute left-[10%] top-[58%] h-14 w-14 bob" viewBox="0 0 64 40" {...base} stroke="var(--lilac)">
        <path d="M14 34 a9 9 0 0 1 0 -18 a12 12 0 0 1 23 -3 a9 9 0 0 1 4 21 z" />
      </svg>
      <svg className="absolute right-[6%] top-[70%] h-9 w-9 twinkle" viewBox="0 0 24 24" {...base} stroke="var(--coral)" style={{ animationDelay: "2s" }}>
        <circle cx="12" cy="12" r="7" />
      </svg>
      <svg className="absolute left-[18%] top-[34%] h-6 w-6 twinkle" viewBox="0 0 24 24" {...base} stroke="var(--coral)" style={{ animationDelay: "0.6s" }}>
        <path d="M12 21 C4 14 3 9 7 6 a5 5 0 0 1 5 2 a5 5 0 0 1 5 -2 c4 3 3 8 -5 15 z" />
      </svg>
    </div>
  );
}
