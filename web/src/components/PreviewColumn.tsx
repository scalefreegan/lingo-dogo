import { useEffect, useRef, useState, type FormEvent } from "react";
import { exportPack } from "../api";
import { slugify, splitPackId } from "../draft";
import type { AssembleResult, ContentReply, ExportResult, Pack, PackInput } from "../types";
import { Badge, Button, Card, ColumnHeading, inputClass } from "./ui";

export type SaveOutcome = { ok: true; id: string } | { ok: false; conflict: string } | { ok: false; error: string };

/** The one-line outcome of the last pack action, shown above the library. */
export type PackStatus = { tone: "ok" | "err"; text: string };

/** Each resolves to whether it succeeded (the status line says what
 *  happened), so an inline form knows whether to close. */
export interface PackActions {
  onLoad: (p: Pack) => void;
  onClone: (p: Pack) => void;
  onMove: (id: string, folder: string) => Promise<boolean>;
  onRename: (id: string, title: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onCreateFolder: (name: string) => Promise<boolean>;
  onDeleteFolder: (name: string) => Promise<boolean>;
}

/* Right column: what you will paste. Actions first (copy, export, save), the
 * saved-pack library, then the assembler's warnings and the literal markdown.
 * The preview is the raw text, not rendered HTML, because the raw text is
 * exactly what the voice tool receives. */
export default function PreviewColumn({
  content,
  pack,
  title,
  sourceId,
  exportId,
  result,
  pending,
  error,
  packs,
  folders,
  packStatus,
  saveRequest,
  onSave,
  ...actions
}: PackActions & {
  content: ContentReply;
  pack: PackInput;
  title: string;
  sourceId: string | null;
  /** The id Export writes to: the saved pack's stem, else date + slug. */
  exportId: string;
  result: AssembleResult | null;
  pending: boolean;
  error: string | null;
  packs: Pack[];
  /** Every folder under content/packs, empty ones included. */
  folders: string[];
  packStatus: PackStatus | null;
  /** Bumped by the parent to open the save form with a suggested title and folder (Clone). */
  saveRequest: { title: string; folder: string; seq: number } | null;
  onSave: (title: string, folder: string, overwrite: boolean) => Promise<SaveOutcome>;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const markdown = result?.markdown ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied("idle"), 2000);
  }

  async function doExport() {
    setExporting(true);
    setExportError(null);
    try {
      setExported(await exportPack(exportId, pack));
    } catch (e) {
      setExported(null);
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-2">
        <ColumnHeading>Prompt</ColumnHeading>
        <span className="truncate text-xs text-fg-3" data-testid="pack-label">
          {title || "Untitled pack"}
          {sourceId && <span className="font-mono"> · {sourceId}</span>}
        </span>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={copy} disabled={!markdown}>
            {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
          </Button>
          <Button onClick={doExport} disabled={!markdown || exporting}>
            {exporting ? "Exporting…" : "Export"}
          </Button>
          <SaveButton
            key={saveRequest?.seq ?? 0}
            initialOpen={saveRequest != null}
            suggested={saveRequest?.title ?? (title || defaultTitle(content, pack))}
            // A loaded pack saves back into its own folder unless told otherwise.
            suggestedFolder={saveRequest?.folder ?? (sourceId ? splitPackId(sourceId).folder : "")}
            folders={folders}
            onSave={onSave}
          />
          <span className="ml-auto text-xs text-fg-3 tabular-nums" data-testid="stats">
            {result ? `${result.stats.words.toLocaleString()} words · ~${result.stats.tokens.toLocaleString()} tokens` : "…"}
            {pending && " · updating"}
          </span>
        </div>
        {exported && (
          <p className="text-xs text-fg-2" data-testid="export-path">
            Exported to <code className="font-mono break-all">{exported.path}</code>
          </p>
        )}
        {exportError && <p className="text-xs text-err">Export failed: {exportError}</p>}
      </Card>

      <SavedPacks packs={packs} folders={folders} content={content} currentId={sourceId} status={packStatus} {...actions} />

      {error && <p className="rounded-md bg-err-soft p-3 text-sm text-err">Could not assemble: {error}</p>}
      {result && result.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-warn-soft p-3 text-sm text-warn" aria-label="Warnings">
          {result.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <pre
        data-testid="preview"
        className="min-h-48 overflow-x-auto rounded-lg border border-line bg-panel p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg"
      >
        {markdown || (pending ? "Assembling…" : "")}
      </pre>
    </div>
  );
}

/** A title to start the save form with: the scenario's, else a generic one. */
function defaultTitle(content: ContentReply, pack: PackInput): string {
  if (pack.quick_scenario.trim()) return pack.quick_scenario.trim().split("\n")[0].slice(0, 60);
  return content.scenarios.find((s) => s.id === pack.scenario)?.title ?? "";
}

/** The small button style every row and header action here uses. */
const small = "px-2 py-1 text-xs";

/** The folder picker the save form and a row's "Move to" share: "No folder"
 *  is the top level of content/packs. */
function FolderSelect({ value, folders, disabled, label, onChange }: {
  value: string;
  folders: string[];
  disabled?: boolean;
  label: string;
  onChange: (folder: string) => void;
}) {
  return (
    <select aria-label={label} className={`${inputClass} w-auto`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">No folder</option>
      {folders.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );
}

/** "Save pack" asks for a title and a folder inline (no window.prompt: a
 *  modal dialog blocks the page and browser automation). A clash with another
 *  saved pack asks once more before overwriting. Success is reported by the
 *  library's status line; only a refusal shows here. */
function SaveButton({
  initialOpen,
  suggested,
  suggestedFolder,
  folders,
  onSave,
}: {
  initialOpen: boolean;
  suggested: string;
  suggestedFolder: string;
  folders: string[];
  onSave: (title: string, folder: string, overwrite: boolean) => Promise<SaveOutcome>;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [value, setValue] = useState(suggested);
  const [folder, setFolder] = useState(suggestedFolder);
  const [conflict, setConflict] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(overwrite: boolean) {
    if (!value.trim()) return;
    setBusy(true);
    setMessage(null);
    const r = await onSave(value.trim(), folder, overwrite);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setConflict(null);
    } else if ("conflict" in r) {
      setConflict(r.conflict);
    } else {
      setMessage(r.error);
    }
  }

  if (!open) {
    return (
      <>
        <Button
          onClick={() => {
            setValue(suggested);
            setFolder(suggestedFolder);
            setOpen(true);
            setMessage(null);
          }}
        >
          Save pack
        </Button>
        {message && (
          <span className="text-xs text-err" data-testid="save-message">
            {message}
          </span>
        )}
      </>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <input
        autoFocus
        aria-label="Pack title"
        className={`${inputClass} min-w-48 flex-1`}
        placeholder="Pack title"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setConflict(null);
        }}
      />
      <FolderSelect
        label="Folder"
        value={folder}
        folders={folders}
        onChange={(f) => {
          setFolder(f);
          setConflict(null);
        }}
      />
      {conflict ? (
        <>
          <span className="text-xs text-warn">{conflict} already exists.</span>
          <Button variant="primary" disabled={busy} onClick={() => void submit(true)}>
            Overwrite
          </Button>
        </>
      ) : (
        <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      )}
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {message && <span className="w-full text-xs text-err">{message}</span>}
    </form>
  );
}

/** The library: every saved pack grouped by folder ("No folder" first), with
 *  a toolbar to make a folder and the status line of the last action. */
function SavedPacks({
  packs,
  folders,
  content,
  currentId,
  status,
  onCreateFolder,
  onDeleteFolder,
  ...row
}: PackActions & {
  packs: Pack[];
  folders: string[];
  content: ContentReply;
  currentId: string | null;
  status: PackStatus | null;
}) {
  // null = closed; otherwise the name being typed.
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Every folder on disk plus any a pack names (one the list has not caught
  // up with yet): "No folder" first, the rest alphabetical.
  const names = [...new Set([...folders, ...packs.map((p) => p.folder).filter(Boolean)])].sort();
  const groups = ["", ...names].map((folder) => ({
    folder,
    // Newest first: stems start with the date.
    packs: packs.filter((p) => p.folder === folder).sort((a, b) => b.id.localeCompare(a.id)),
  }));
  const slug = slugify(newFolder ?? "", "");

  async function submitFolder(e: FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setBusy(true);
    if (await onCreateFolder(slug)) setNewFolder(null);
    setBusy(false);
  }

  return (
    <details className="rounded-lg border border-line bg-panel" open>
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-fg select-none">
        Saved packs <span className="text-fg-3">({packs.length})</span>
      </summary>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2" data-testid="packs-toolbar">
        {newFolder === null ? (
          <Button variant="ghost" className={small} onClick={() => setNewFolder("")}>
            New folder
          </Button>
        ) : (
          <form className="flex flex-1 flex-wrap items-center gap-2" onSubmit={(e) => void submitFolder(e)}>
            <input
              autoFocus
              aria-label="Folder name"
              className={`${inputClass} min-w-32 flex-1`}
              placeholder="Folder name"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
            {/* The name is slugified like a pack title; show the result when it differs. */}
            {slug && slug !== newFolder && <span className="font-mono text-xs text-fg-3">{slug}</span>}
            <Button type="submit" variant="primary" className={small} disabled={busy || !slug}>
              Create
            </Button>
            <Button variant="ghost" className={small} onClick={() => setNewFolder(null)}>
              Cancel
            </Button>
          </form>
        )}
        {status && (
          <span className={`ml-auto min-w-0 truncate text-xs ${status.tone === "ok" ? "text-accent" : "text-err"}`} data-testid="packs-status" title={status.text}>
            {status.text}
          </span>
        )}
      </div>
      {packs.length === 0 && names.length === 0 ? (
        <p className="border-t border-line px-4 py-3 text-sm text-fg-3">None yet. Save one to reopen it later.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto border-t border-line" aria-label="Saved packs">
          {groups.map(
            (g) =>
              (g.folder || g.packs.length > 0) && (
                <section key={g.folder || "/"} aria-label={g.folder || "No folder"} data-testid={`folder-${g.folder || "none"}`}>
                  <header className="flex items-center gap-2 bg-raised px-4 py-1.5 text-xs font-medium text-fg-2">
                    <span className={g.folder ? "font-mono" : ""}>{g.folder || "No folder"}</span>
                    <span className="text-fg-3">({g.packs.length})</span>
                    {g.folder && g.packs.length === 0 && (
                      <Button variant="ghost" className={`ml-auto ${small} py-0.5`} onClick={() => void onDeleteFolder(g.folder)}>
                        Delete folder
                      </Button>
                    )}
                  </header>
                  <ul>
                    {g.packs.map((p) => (
                      <PackRow key={p.id} pack={p} content={content} open={p.id === currentId} folders={names} {...row} />
                    ))}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}
    </details>
  );
}

/** One saved pack: Load and Clone up front; Move, Rename and Delete behind a
 *  "…" toggle, since they change files. Delete is the one action that asks
 *  (window.confirm — the file goes, though git keeps it). */
function PackRow({
  pack: p,
  content,
  open,
  folders,
  onLoad,
  onClone,
  onMove,
  onRename,
  onDelete,
}: Omit<PackActions, "onCreateFolder" | "onDeleteFolder"> & {
  pack: Pack;
  content: ContentReply;
  open: boolean;
  folders: string[];
}) {
  const [mode, setMode] = useState<"closed" | "menu" | "rename">("closed");
  const [title, setTitle] = useState(p.title);
  const [busy, setBusy] = useState(false);
  const { stem } = splitPackId(p.id);
  const scenario = p.scenario
    ? (content.scenarios.find((s) => s.id === p.scenario)?.title ?? p.scenario)
    : p.quick_scenario
      ? "Quick scenario"
      : "No scenario";

  /** A move or rename that succeeds re-lists the library under a new id, so
   *  this row is replaced; closing is for the failure that leaves it here. */
  async function run(action: Promise<boolean>) {
    setBusy(true);
    const ok = await action;
    setBusy(false);
    if (ok) setMode("closed");
  }

  return (
    <li className="border-b border-line px-4 py-2 last:border-b-0" data-testid={`pack-${p.id}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-fg">{p.title}</span>
            {open && <Badge tone="accent">open</Badge>}
          </div>
          <div className="truncate text-xs text-fg-3">
            <span className="font-mono">{stem.slice(0, 10)}</span> · {scenario} · {p.units.length} units
          </div>
        </div>
        <Button variant="ghost" className={small} onClick={() => onLoad(p)}>
          Load
        </Button>
        <Button variant="ghost" className={small} onClick={() => onClone(p)}>
          Clone
        </Button>
        <Button
          variant="ghost"
          className={small}
          aria-label={`More actions for ${p.title}`}
          aria-expanded={mode !== "closed"}
          onClick={() => setMode(mode === "closed" ? "menu" : "closed")}
        >
          …
        </Button>
      </div>
      {mode === "menu" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-fg-3">
            Move to
            <FolderSelect label={`Move ${p.title} to`} value={p.folder} folders={folders} disabled={busy} onChange={(f) => void run(onMove(p.id, f))} />
          </label>
          <Button
            variant="ghost"
            className={small}
            disabled={busy}
            onClick={() => {
              setTitle(p.title);
              setMode("rename");
            }}
          >
            Rename…
          </Button>
          <Button
            variant="ghost"
            className={`${small} text-err`}
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete "${p.title}" (${p.id})?\nThe file is removed from content/packs; git keeps its history.`)) void run(onDelete(p.id));
            }}
          >
            Delete
          </Button>
        </div>
      )}
      {mode === "rename" && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void run(onRename(p.id, title.trim()));
          }}
        >
          <input
            autoFocus
            aria-label={`New title for ${p.title}`}
            className={`${inputClass} min-w-40 flex-1`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button type="submit" variant="primary" className={small} disabled={busy || !title.trim()}>
            Rename
          </Button>
          <Button variant="ghost" className={small} onClick={() => setMode("menu")}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}
