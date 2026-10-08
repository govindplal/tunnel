"use client";
import { useEffect, useState } from "react";

type State = "unsupported" | NotificationPermission;

/**
 * Browsers only allow copying to the clipboard from a focused tab. A desktop alert lets the user
 * click straight to copy text that arrived while the tab was in the background.
 */
export function AlertsToggle() {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    // Notification only exists in the browser, so the permission can only be read after mounting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  if (state === null || state === "unsupported" || state === "granted") return null;
  if (state === "denied") {
    return (
      <p className="text-xs text-muted">
        Desktop alerts are blocked for this site. Allow notifications in your browser settings to get a click-to-copy alert when
        text arrives while this tab is in the background.
      </p>
    );
  }
  return (
    <button
      className="btn"
      onClick={() => void Notification.requestPermission().then(setState)}
    >
      Turn on desktop alerts
    </button>
  );
}
