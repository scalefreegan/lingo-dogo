import { useEffect, useRef, useState } from "react";
import { exportPack } from "../api";
import type { AssembleResult, ContentReply, ExportResult, Pack, PackInput } from "../types";
import { Badge, Button, Card, ColumnHeading, inputClass } from "./ui";

export type SaveOutcome = { ok: true; id: string } | { ok: false; conflict: string } | { ok: false; error: string };

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
  saveRequest,
  onSave,
  onLoad,
  onClone,
}: {
  content: ContentReply;
  pack: PackInput;
  title: string;
  sourceId: string | null;
  /** The id Export writes to: the saved pack's, else date + slug. */
  exportId: string;
  result: AssembleResult | null;
  pending: boolean;
  error: string | null;
  packs: Pack[];
  /** Bumped by the parent to open the save form with a suggested title (Clone). */
  saveRequest: { title: string; seq: number } | null;
  onSave: (title: string, overwrite: boolean) => Promise<SaveOutcome>;
  onLoad: (p: Pack) => void;
  onClone: (p: Pack) => void;
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

      <SavedPacks packs={packs} content={content} currentId={sourceId} onLoad={onLoad} onClone={onClone} />

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

/** "Save pack" asks for a title inline (no window.prompt: a modal dialog
 *  blocks the page and browser automation). A clash with another saved pack
 *  asks once more before overwriting. */
function SaveButton({
  initialOpen,
  suggested,
  onSave,
}: {
  initialOpen: boolean;
  suggested: string;
  onSave: (title: string, overwrite: boolean) => Promise<SaveOutcome>;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [value, setValue] = useState(suggested);
  const [conflict, setConflict] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(overwrite: boolean) {
    if (!value.trim()) return;
    setBusy(true);
    setMessage(null);
    const r = await onSave(value.trim(), overwrite);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setConflict(null);
      setMessage({ tone: "ok", text: `Saved as ${r.id}` });
    } else if ("conflict" in r) {
      setConflict(r.conflict);
    } else {
      setMessage({ tone: "err", text: r.error });
    }
  }

  if (!open) {
    return (
      <>
        <Button
          onClick={() => {
            setValue(suggested);
            setOpen(true);
            setMessage(null);
          }}
        >
          Save pack
        </Button>
        {message && (
          <span className={`text-xs ${message.tone === "ok" ? "text-accent" : "text-err"}`} data-testid="save-message">
            {message.text}
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
      {message && <span className="w-full text-xs text-err">{message.text}</span>}
    </form>
  );
}

function SavedPacks({
  packs,
  content,
  currentId,
  onLoad,
  onClone,
}: {
  packs: Pack[];
  content: ContentReply;
  currentId: string | null;
  onLoad: (p: Pack) => void;
  onClone: (p: Pack) => void;
}) {
  // Newest first: ids start with the date.
  const sorted = [...packs].sort((a, b) => b.id.localeCompare(a.id));
  return (
    <details className="rounded-lg border border-line bg-panel" open>
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-fg select-none">
        Saved packs <span className="text-fg-3">({packs.length})</span>
      </summary>
      {sorted.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-fg-3">None yet. Save one to reopen it later.</p>
      ) : (
        <ul className="max-h-56 overflow-y-auto border-t border-line" aria-label="Saved packs">
          {sorted.map((p) => {
            const scenario = p.scenario ? (content.scenarios.find((s) => s.id === p.scenario)?.title ?? p.scenario) : p.quick_scenario ? "Quick scenario" : "No scenario";
            return (
              <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-fg">{p.title}</span>
                    {p.id === currentId && <Badge tone="accent">open</Badge>}
                  </div>
                  <div className="truncate text-xs text-fg-3">
                    <span className="font-mono">{p.id.slice(0, 10)}</span> · {scenario} · {p.units.length} units
                  </div>
                </div>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onLoad(p)}>
                  Load
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onClone(p)}>
                  Clone
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
