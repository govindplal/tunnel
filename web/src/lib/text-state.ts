// State machine for the phone's list of sent texts. Pure, so the rules are testable.
export type TextState =
  | "sent" // handed to the relay
  | "queued" // the computer isn't connected: the relay is holding it (encrypted, up to 30 min)
  | "received" // the computer has it
  | "copied" // ...and put it on its clipboard
  | "stored" // ...but couldn't copy yet (tab in the background): copied when the user returns
  | "rejected" // not delivered: the relay's hold queue was full, or the computer couldn't read it
  | "unconfirmed"; // no word back in time while the computer seemed to be online

export interface SentText {
  id: string;
  preview: string;
  state: TextState;
}

export type TextEvent =
  | { type: "add"; id: string; preview: string }
  | { type: "queued"; id: string }
  | { type: "delivered"; id: string }
  | { type: "acked"; id: string; copied: boolean }
  | { type: "rejected"; id: string }
  | { type: "timeout"; id: string };

export const MAX_SENT_LISTED = 5;

const move = (list: SentText[], id: string, from: TextState[], to: TextState): SentText[] => {
  let changed = false;
  const next = list.map((t) => {
    if (t.id !== id || !from.includes(t.state)) return t;
    changed = true;
    return { ...t, state: to };
  });
  return changed ? next : list; // same array when nothing changed: no re-render
};

/** "copied" is never downgraded, and a late or repeated event can't move a text backwards. */
export function reduceTexts(list: SentText[], ev: TextEvent): SentText[] {
  switch (ev.type) {
    case "add":
      return [{ id: ev.id, preview: ev.preview, state: "sent" as const }, ...list].slice(0, MAX_SENT_LISTED);
    case "queued":
      return move(list, ev.id, ["sent"], "queued");
    case "delivered":
      return move(list, ev.id, ["sent", "queued", "unconfirmed"], "received");
    case "acked":
      // An ack proves the computer really has it, so it also corrects an earlier "rejected" (e.g. the
      // relay's queue was full but the message was delivered live).
      return ev.copied
        ? move(list, ev.id, ["sent", "queued", "received", "stored", "unconfirmed", "rejected"], "copied")
        : move(list, ev.id, ["sent", "queued", "received", "unconfirmed", "rejected"], "stored");
    case "rejected":
      return move(list, ev.id, ["sent", "queued"], "rejected");
    case "timeout":
      return move(list, ev.id, ["sent"], "unconfirmed");
  }
}
