import { useState } from "react";
import type { ContentReply, Mode, ProfileRequest } from "../types";
import type { Draft } from "../draft";
import { Button } from "./ui";
import ProfileControl from "./ProfileControl";
import type { Tab } from "./shared";

/* The top bar: the app's name (with a "Kids" tag when that library is
 * open), the three-step flow as tabs, Library off to the side (it's a
 * destination, not a step), and the two actions that touch the whole draft
 * (New pack, Reload content) tucked behind "…" so they don't compete with
 * the tabs for attention. On a phone (below `sm`) Library moves into that
 * "…" menu — the bar can't hold four tabs and the menu at 390px — and the
 * three flow tabs scroll in their own strip rather than widening the page. */
export default function TopBar({
  tab,
  onTab,
  onNewPack,
  onReload,
  reloading,
  ready,
  mode,
  onMode,
  content,
  draft,
  onChange,
  onSaveDefaults,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  onNewPack: () => void;
  onReload: () => void;
  reloading: boolean;
  ready: boolean;
  mode: Mode;
  onMode: (m: Mode) => void;
  /** Null until the first load; the Profile pill appears with them. */
  content: ContentReply | null;
  draft: Draft | null;
  onChange: (d: Draft) => void;
  onSaveDefaults: (values: ProfileRequest) => Promise<string | null>;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-4 sm:pr-10">
      <h1 className="mr-2 flex shrink-0 items-center gap-1.5 text-base font-semibold text-fg">
        Lingo Dojo
        {mode === "kids" && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium leading-none text-accent" data-testid="mode-tag">
            Kids
          </span>
        )}
      </h1>
      {/* min-w-0 + overflow-x-auto: on a phone narrower than the three tabs
          the strip scrolls sideways by itself instead of widening the page. */}
      <nav className="flex h-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]" aria-label="Sections">
        <TabButton label="Scene" active={tab === "scene"} onClick={() => onTab("scene")} />
        <TabButton label="Customize" active={tab === "customize"} onClick={() => onTab("customize")} />
        <TabButton label="Go" active={tab === "go"} onClick={() => onTab("go")} />
      </nav>
      <div className="ml-auto flex h-full shrink-0 items-center gap-1">
        {content && draft && (
          <ProfileControl content={content} draft={draft} mode={mode} onMode={onMode} onChange={onChange} onSaveDefaults={onSaveDefaults} />
        )}
        <TabButton label="Library" active={tab === "library"} onClick={() => onTab("library")} className="hidden sm:flex" />
        <OverflowMenu onNewPack={onNewPack} onReload={onReload} reloading={reloading} ready={ready} libraryActive={tab === "library"} onLibrary={() => onTab("library")} />
      </div>
    </header>
  );
}

function TabButton({ label, active, onClick, className = "" }: { label: string; active: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex h-full shrink-0 items-center border-b-2 px-3 text-sm font-medium transition-colors ${
        active ? "border-accent text-fg" : "border-transparent text-fg-3 hover:text-fg-2"
      } ${className}`}
    >
      {label}
    </button>
  );
}

const menuItemClass = "px-3 py-2 text-left text-sm text-fg-2 hover:bg-raised disabled:opacity-50";

/** New pack and Reload content: whole-draft actions, not part of the Scene →
 *  Customize → Go flow, so they live behind an overflow toggle instead of
 *  sitting next to the tabs. Library joins them on a phone, where the bar
 *  has no room for its tab. */
function OverflowMenu({
  onNewPack,
  onReload,
  reloading,
  ready,
  libraryActive,
  onLibrary,
}: {
  onNewPack: () => void;
  onReload: () => void;
  reloading: boolean;
  ready: boolean;
  libraryActive: boolean;
  onLibrary: () => void;
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
              aria-current={libraryActive ? "page" : undefined}
              className={`${menuItemClass} border-b border-line sm:hidden ${libraryActive ? "font-medium text-fg" : ""}`}
              onClick={() => {
                onLibrary();
                setOpen(false);
              }}
            >
              Library
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!ready}
              className={menuItemClass}
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
              className={menuItemClass}
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
