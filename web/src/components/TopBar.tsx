import { useState } from "react";
import { Button } from "./ui";
import type { Tab } from "./shared";

/* The top bar: the app's name, the three-step flow as tabs, Library off to
 * the side (it's a destination, not a step), and the two actions that touch
 * the whole draft (New pack, Reload content) tucked behind "…" so they don't
 * compete with the tabs for attention. */
export default function TopBar({
  tab,
  onTab,
  onNewPack,
  onReload,
  reloading,
  ready,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onNewPack: () => void;
  onReload: () => void;
  reloading: boolean;
  ready: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-4 pr-10">
      <h1 className="mr-2 shrink-0 text-base font-semibold text-fg">Lingo Dojo</h1>
      <nav className="flex h-full items-center gap-1" aria-label="Sections">
        <TabButton label="Scene" active={tab === "scene"} onClick={() => onTab("scene")} />
        <TabButton label="Customize" active={tab === "customize"} onClick={() => onTab("customize")} />
        <TabButton label="Go" active={tab === "go"} onClick={() => onTab("go")} />
      </nav>
      <div className="ml-auto flex h-full items-center gap-1">
        <TabButton label="Library" active={tab === "library"} onClick={() => onTab("library")} />
        <OverflowMenu onNewPack={onNewPack} onReload={onReload} reloading={reloading} ready={ready} />
      </div>
    </header>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex h-full items-center border-b-2 px-3 text-sm font-medium transition-colors ${
        active ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2"
      }`}
    >
      {label}
    </button>
  );
}

/** New pack and Reload content: whole-draft actions, not part of the Scene →
 *  Customize → Go flow, so they live behind an overflow toggle instead of
 *  sitting next to the tabs. */
function OverflowMenu({
  onNewPack,
  onReload,
  reloading,
  ready,
}: {
  onNewPack: () => void;
  onReload: () => void;
  reloading: boolean;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="ghost" aria-haspopup="menu" aria-expanded={open} aria-label="More actions" onClick={() => setOpen((o) => !o)}>
        ⋯
      </Button>
      {open && (
        <>
          {/* Closes the menu on an outside click, without a ref or a document listener. */}
          <button type="button" aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 z-50 mt-1 flex w-44 flex-col overflow-hidden rounded-md border border-line bg-panel py-1 shadow-md">
            <button
              type="button"
              role="menuitem"
              disabled={!ready}
              className="px-3 py-2 text-left text-sm text-fg-2 hover:bg-raised disabled:opacity-50"
              onClick={() => {
                onNewPack();
                setOpen(false);
              }}
            >
              New pack
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={reloading}
              className="px-3 py-2 text-left text-sm text-fg-2 hover:bg-raised disabled:opacity-50"
              onClick={() => {
                onReload();
                setOpen(false);
              }}
            >
              {reloading ? "Reloading…" : "Reload content"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
