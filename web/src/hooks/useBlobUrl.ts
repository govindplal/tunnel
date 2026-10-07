"use client";
import { useEffect, useState } from "react";

/**
 * An object URL for `blob`, revoked when the blob changes or the component unmounts.
 * While a replacement blob is being turned into a URL, the previous URL stays in use so lists
 * of thumbnails don't flash back to placeholders every time the list reloads from storage.
 * Use it in a component that always shows the same item (e.g. keyed by file id).
 */
export function useBlobUrl(blob: Blob | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const next = URL.createObjectURL(blob);
    // Creating the URL is a side effect on an external resource, so it has to live here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return blob ? url : null;
}
