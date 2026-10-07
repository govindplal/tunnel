import type { Status } from "@/lib/connection";

export function StatusBadge({
  status,
  paired,
  wasPaired = false,
}: {
  status: Status;
  paired: boolean;
  /** this device was paired before; the other one just isn't connected right now */
  wasPaired?: boolean;
}) {
  const [label, dot] = paired
    ? ["Paired", "bg-emerald-500"]
    : status === "open"
      ? wasPaired
        ? ["Paired (other device not connected right now)", "bg-sky-500"]
        : ["Waiting for the other device", "bg-amber-500"]
      : status === "closed"
        ? ["Offline", "bg-zinc-400"]
        : ["Connecting…", "bg-amber-500"];
  return (
    <p role="status" className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
      <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
      {label}
    </p>
  );
}
