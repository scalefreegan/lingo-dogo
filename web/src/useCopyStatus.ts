import { useEffect, useRef, useState } from "react";

export type CopyStatus = "idle" | "copied" | "failed";

/** Copies text to the clipboard and reports a transient status (back to
 *  "idle" after 2s) — shared by the summary bar's and the Go tab's Copy
 *  buttons, each with its own status so they can show independent feedback. */
export function useCopyStatus(): [CopyStatus, (text: string) => void] {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => setStatus("copied"),
      () => setStatus("failed"),
    );
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 2000);
  }

  return [status, copy];
}
