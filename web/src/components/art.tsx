/**
 * The one piece of art: a tunnel drawn as nested loops, like a pen that kept circling inward.
 * Each loop is a slightly off-center arch that overshoots the ground with a little curl.
 */
const LOOPS = [
  { w: 84, top: 14, dx: 0, curl: 1 },
  { w: 70, top: 28, dx: 3, curl: -1 },
  { w: 57, top: 42, dx: -2, curl: 1 },
  { w: 45, top: 56, dx: 3, curl: -1 },
  { w: 34, top: 70, dx: -1, curl: 1 },
  { w: 24, top: 84, dx: 2, curl: -1 },
  { w: 15, top: 98, dx: 0, curl: 1 },
];

function loopPath({ w, top, dx, curl }: (typeof LOOPS)[number]): string {
  const cx = 100 + dx;
  const l = cx - w;
  const r = cx + w;
  const ground = 148;
  const k = w * 0.56; // bezier handle length: close to a true half-circle
  const c = 7 * curl; // the overshoot curl sways left or right
  return [
    `M${l - c} ${ground + 6}`,
    `C${l - c * 2} ${ground + 12} ${l + c} ${ground + 12} ${l} ${ground - 4}`,
    `V${top + w}`,
    `C${l} ${top + w - k * 1.75} ${cx - k} ${top} ${cx} ${top}`,
    `C${cx + k} ${top} ${r} ${top + w - k * 1.75} ${r} ${top + w}`,
    `V${ground - 4}`,
    `C${r - c} ${ground + 12} ${r + c * 2} ${ground + 12} ${r + c} ${ground + 6}`,
  ].join(" ");
}

export function Tunnel({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {LOOPS.map((p, i) => (
        <path key={i} d={loopPath(p)} />
      ))}
    </svg>
  );
}
