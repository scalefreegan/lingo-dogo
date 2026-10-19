import { useState } from "react";
import ChatPanel from "./ChatPanel";

/* The embedded agent chat, docked to the right edge. The drawer is hidden
 * rather than unmounted when closed, so a run in progress (and the transcript
 * the panel holds) survives toggling it. `onContentChanged` is App's
 * reloadContent — the same function the header's "Reload content" button
 * calls — so a unit the agent just added appears in its slot at once. */
export default function AgentDrawer({ onContentChanged }: { onContentChanged: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="agent-drawer"
        onClick={() => setOpen((o) => !o)}
        className="fixed top-1/2 right-0 z-30 -translate-y-1/2 rounded-l-md border border-r-0 border-line-strong bg-panel px-1.5 py-3 text-xs font-medium text-fg-2 shadow-sm [writing-mode:vertical-rl] hover:text-fg"
      >
        {open ? "Close agent" : "Agent"}
      </button>
      <aside
        id="agent-drawer"
        aria-label="Agent"
        hidden={!open}
        className="fixed top-0 right-0 z-20 flex h-full w-full max-w-md flex-col border-l border-line bg-panel shadow-xl"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 pr-10">
          <h2 className="font-medium text-fg">Agent</h2>
          <span className="text-xs text-fg-3">edits content/ · every change is a commit</span>
        </header>
        <ChatPanel onContentChanged={onContentChanged} />
      </aside>
    </>
  );
}
