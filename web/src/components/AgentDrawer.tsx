import { useState } from "react";
import type { Mode } from "../types";
import ChatPanel from "./ChatPanel";
import { Button } from "./ui";

/* The embedded agent chat, docked to the right edge: a side panel on a
 * desktop, the whole screen on a phone (max-w-md is wider than the phone).
 * It sits above the sticky top bar (z-40 > the bar's z-30), otherwise the
 * bar covers this header and its close button. The drawer is hidden rather
 * than unmounted when closed, so a run in progress (and the transcript the
 * panel holds) survives toggling it. `onContentChanged` is App's
 * reloadContent — the same function the header's "Reload content" button
 * calls — so a unit the agent just added appears in its slot at once. The
 * agent is told which library (`mode`) the user is looking at. */
export default function AgentDrawer({ mode, onContentChanged }: { mode: Mode; onContentChanged: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const tree = mode === "kids" ? "content/kids/" : "content/";
  return (
    <>
      {/* z-50: stays clickable on top of the open drawer (z-40). On a phone
          the tab would float over the chat, where the sheet is full-width,
          so it hides there and the header's × closes the sheet instead. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="agent-drawer"
        onClick={() => setOpen((o) => !o)}
        className={`fixed top-1/2 right-0 z-50 -translate-y-1/2 rounded-l-md border border-r-0 border-line-strong bg-panel px-2 py-3 text-sm font-medium text-fg-2 shadow-sm [writing-mode:vertical-rl] hover:text-fg sm:px-1.5 sm:text-xs ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        {open ? "Close agent" : "Agent"}
      </button>
      <aside
        id="agent-drawer"
        aria-label="Agent"
        hidden={!open}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-xl"
      >
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 sm:pr-10">
          <h2 className="font-medium text-fg">Agent</h2>
          <span className="min-w-0 flex-1 truncate text-sm text-fg-3 sm:text-xs">edits {tree} · every change is a commit</span>
          <Button variant="ghost" aria-label="Close agent panel" className="min-w-10 shrink-0 justify-center px-2 text-lg leading-none" onClick={() => setOpen(false)}>
            ×
          </Button>
        </header>
        <ChatPanel mode={mode} onContentChanged={onContentChanged} />
      </aside>
    </>
  );
}
