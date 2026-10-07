// State machine for the phone's list of outgoing files. Pure, so the rules are testable.
export type TransferState = "queued" | "sending" | "waiting" | "delivered" | "failed" | "cancelled";

export interface Transfer {
  id: string;
  name: string;
  size: number;
  pct: number;
  state: TransferState;
  error?: string;
  /** failed only because no ack arrived in time; a late "ok" ack may still correct it */
  timedOut?: boolean;
  /** bytes the computer reports having received so far (always <= size) */
  arrived?: number;
}

export type TransferEvent =
  | { type: "add"; id: string; name: string; size: number }
  | { type: "start"; id: string }
  | { type: "progress"; id: string; pct: number }
  | { type: "sent"; id: string }
  | { type: "arrived"; id: string; received: number }
  | { type: "fail"; id: string; error: string }
  | { type: "cancel"; id: string }
  | { type: "ack"; id: string; ok: boolean; reason?: string }
  | { type: "ackTimeout"; id: string }
  | { type: "connectionLost" }
  | { type: "dismiss"; id: string };

export const MAX_LISTED = 8;
export const TIMEOUT_MESSAGE = "No confirmation from the computer.";

const update = (list: Transfer[], id: string, from: TransferState[], to: (t: Transfer) => Transfer): Transfer[] => {
  let changed = false;
  const next = list.map((t) => {
    if (t.id !== id || !from.includes(t.state)) return t;
    const r = to(t);
    if (r !== t) changed = true; // returning the same object means "nothing to change"
    return r;
  });
  return changed ? next : list; // same array when nothing changed: no re-render
};

/** Terminal states (delivered, failed, cancelled) only change in the explicitly allowed cases below. */
export function reduceTransfers(list: Transfer[], ev: TransferEvent): Transfer[] {
  switch (ev.type) {
    case "add":
      return [{ id: ev.id, name: ev.name, size: ev.size, pct: 0, state: "queued" as const }, ...list].slice(0, MAX_LISTED);
    case "start":
      return update(list, ev.id, ["queued"], (t) => ({ ...t, state: "sending" }));
    case "progress":
      return update(list, ev.id, ["sending"], (t) => ({ ...t, pct: ev.pct }));
    case "sent":
      return update(list, ev.id, ["sending"], (t) => ({ ...t, pct: 100, state: "waiting" }));
    case "arrived":
      return update(list, ev.id, ["sending", "waiting"], (t) =>
        // monotonic and clamped: a reordered or bogus report can't move the bar backwards or past 100%
        (t.arrived ?? 0) >= Math.min(ev.received, t.size) ? t : { ...t, arrived: Math.min(ev.received, t.size) },
      );
    case "fail":
      return update(list, ev.id, ["queued", "sending"], (t) => ({ ...t, state: "failed", error: ev.error }));
    case "cancel":
      return update(list, ev.id, ["queued", "sending"], (t) => ({ ...t, state: "cancelled" }));
    case "ack":
      if (ev.ok) {
        // A timed-out transfer may still turn out to have arrived.
        return list.map((t) =>
          t.id === ev.id && (t.state === "sending" || t.state === "waiting" || (t.state === "failed" && t.timedOut))
            ? { ...t, state: "delivered" as const, pct: 100, error: undefined, timedOut: false }
            : t,
        );
      }
      return update(list, ev.id, ["queued", "sending", "waiting"], (t) => ({
        ...t,
        state: "failed",
        error: ev.reason ?? "The computer refused the file.",
      }));
    case "ackTimeout":
      return update(list, ev.id, ["waiting"], (t) => ({ ...t, state: "failed", error: TIMEOUT_MESSAGE, timedOut: true }));
    case "connectionLost":
      return list.some((t) => t.state === "queued" || t.state === "sending")
        ? list.map((t) =>
            t.state === "queued" || t.state === "sending"
              ? { ...t, state: "failed" as const, error: "Connection lost. Send it again." }
              : t,
          )
        : list;
    case "dismiss":
      return list.filter((t) => t.id !== ev.id);
  }
}
