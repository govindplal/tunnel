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
    ? ["Paired", "bg-ink"]
    : status === "open"
      ? wasPaired
        ? ["Paired (other device not connected right now)", "bg-paper-2"]
        : ["Waiting for the other device", "bg-paper"]
      : status === "closed"
        ? ["Offline", "bg-muted"]
        : ["Connecting…", "bg-paper"];
  return (
    <p role="status" className="inline-flex items-center gap-2 rounded-full border-2 border-line px-4 py-2 text-sm font-semibold">
      <span className={`h-3 w-3 rounded-full border-2 border-line ${dot}`} />
      {label}
    </p>
  );
}
