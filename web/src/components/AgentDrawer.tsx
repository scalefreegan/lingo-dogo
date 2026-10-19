import { useState } from "react";

/* ==== MOUNT POINT: embedded agent chat ====
 * The agent-chat work (server/chat.ts + a ChatPanel modelled on wine-guide's)
 * replaces the placeholder body below; the right-edge toggle and the drawer
 * frame can stay. After an agent turn that edited content/, the library and
 * the preview must reload: add an `onContentChanged` prop here and pass App's
 * `reloadContent` (the same function the header's "Reload content" button
 * calls). */
export default function AgentDrawer() {
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
      {open && (
        <aside
          id="agent-drawer"
          aria-label="Agent"
          className="fixed top-0 right-0 z-20 flex h-full w-full max-w-sm flex-col border-l border-line bg-panel shadow-xl"
        >
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 pr-10">
            <h2 className="font-medium text-fg">Agent</h2>
          </header>
          {/* ---- placeholder: replace with the chat panel ---- */}
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center" data-agent-placeholder>
            <p className="font-medium text-fg">Agent coming soon</p>
            <p className="text-sm text-fg-3">
              Ask it to add or revise units and scenarios; it will edit files under content/ and each change becomes a git commit.
            </p>
          </div>
          {/* ---- end placeholder ---- */}
        </aside>
      )}
    </>
  );
}
