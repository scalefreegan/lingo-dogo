import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, assemblePack, getContent, listPacks, savePack } from "./api";
import type { AssembleResult, ContentReply, Pack, PackInput, PacksReply, Problem } from "./types";
import { draftToPack, localTimestamp, newDraft, packId, packToDraft, type Draft } from "./draft";
import ScenarioColumn from "./components/ScenarioColumn";
import SlotsColumn from "./components/SlotsColumn";
import PreviewColumn, { type SaveOutcome } from "./components/PreviewColumn";
import AgentDrawer from "./components/AgentDrawer";
import { Button } from "./components/ui";

/** Debounce for the live preview: long enough to coalesce typing in the
 *  notes box, short enough that a checkbox feels immediate. */
const ASSEMBLE_DELAY_MS = 200;

export default function App() {
  const [content, setContent] = useState<ContentReply | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  // Bumped by every content reload so the preview re-assembles against the
  // new library even when the draft itself didn't change.
  const [contentVersion, setContentVersion] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [result, setResult] = useState<AssembleResult | null>(null);
  const [assembleError, setAssembleError] = useState<string | null>(null);
  // Which (pack, contentVersion) the shown result answers. "Updating" is
  // derived from it rather than flagged from inside the effect, so the effect
  // only ever sets state from its async callbacks.
  const [settled, setSettled] = useState<{ pack: PackInput; version: number } | null>(null);
  const [saveRequest, setSaveRequest] = useState<{ title: string; seq: number } | null>(null);

  const applyLoad = useCallback((c: ContentReply, p: PacksReply) => {
    setContent(c);
    setPacks(p.packs);
    setLoadError(null);
    setContentVersion((v) => v + 1);
    // The first load starts a new pack from the library's defaults; later
    // reloads keep the draft (a unit that vanished shows up as a warning).
    setDraft((d) => d ?? newDraft(c));
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([getContent(), listPacks()]).then(
      ([c, p]) => live && applyLoad(c, p),
      (e) => live && setLoadError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [applyLoad]);

  async function reloadContent() {
    setReloading(true);
    try {
      const [c, p] = await Promise.all([getContent(), listPacks()]);
      applyLoad(c, p);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setReloading(false);
    }
  }

  const pack = useMemo(() => (draft ? draftToPack(draft) : null), [draft]);
  const assembling = !!pack && (settled?.pack !== pack || settled.version !== contentVersion);

  // Live preview. Each change aborts the request before it, so a slow reply
  // to an old draft can never land on top of the newest one.
  useEffect(() => {
    if (!pack) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      assemblePack(pack, ctrl.signal).then(
        (r) => {
          setResult(r);
          setAssembleError(null);
          setSettled({ pack, version: contentVersion });
        },
        (e) => {
          if (ctrl.signal.aborted) return;
          setAssembleError((e as Error).message);
          setSettled({ pack, version: contentVersion });
        },
      );
    }, ASSEMBLE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [pack, contentVersion]);

  const scenarioTitle = useMemo(() => {
    if (!content || !pack) return "";
    if (pack.quick_scenario.trim()) return "Quick scenario";
    return content.scenarios.find((s) => s.id === pack.scenario)?.title ?? "";
  }, [content, pack]);

  async function save(title: string, overwrite: boolean): Promise<SaveOutcome> {
    if (!draft || !pack) return { ok: false, error: "nothing to save" };
    // Same title as the pack it was loaded from → update that file in place;
    // a new title is a new file named for today.
    const id = draft.sourceId && title === draft.title ? draft.sourceId : packId(title);
    if (!overwrite && id !== draft.sourceId && packs.some((p) => p.id === id)) return { ok: false, conflict: id };
    const created = id === draft.sourceId && draft.created ? draft.created : localTimestamp();
    try {
      const { pack: saved } = await savePack(id, { ...pack, title, created });
      setDraft((d) => (d ? { ...d, title: saved.title, sourceId: saved.id, created: saved.created } : d));
      setPacks((await listPacks()).packs);
      return { ok: true, id: saved.id };
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : String(e) };
    }
  }

  function load(p: Pack) {
    setDraft(packToDraft(p));
    setSaveRequest(null);
  }

  /** Clone = load under a new title: detached from the original file, with
   *  the save form open so the copy gets its own name. */
  function clone(p: Pack) {
    const title = `${p.title} (copy)`;
    setDraft({ ...packToDraft(p), title, sourceId: null, created: "" });
    setSaveRequest((r) => ({ title, seq: (r?.seq ?? 0) + 1 }));
  }

  function startNew() {
    if (!content) return;
    setDraft(newDraft(content));
    setSaveRequest(null);
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 pr-10">
        <h1 className="font-semibold tracking-tight text-fg">Lingo Dogo</h1>
        <span className="hidden text-sm text-fg-3 sm:inline">prompt packs for the dojo master</span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={startNew} disabled={!content}>
            New pack
          </Button>
          <Button onClick={() => void reloadContent()} disabled={reloading}>
            {reloading ? "Reloading…" : "Reload content"}
          </Button>
        </div>
      </header>

      {loadError && <p className="bg-err-soft px-4 py-2 text-sm text-err">Could not load content: {loadError}</p>}
      {content && content.problems.length > 0 && <ProblemsStrip problems={content.problems} />}

      {content && draft && pack ? (
        <main className="grid flex-1 grid-cols-1 gap-5 p-4 lg:min-h-0 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)_minmax(0,1.3fr)] lg:pr-10">
          <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <ScenarioColumn content={content} draft={draft} onChange={setDraft} />
          </div>
          <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <SlotsColumn content={content} draft={draft} onChange={setDraft} />
          </div>
          <div className="lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            <PreviewColumn
              content={content}
              pack={pack}
              title={draft.title}
              sourceId={draft.sourceId}
              exportId={draft.sourceId ?? packId(draft.title || scenarioTitle || "session")}
              result={result}
              pending={assembling}
              error={assembleError}
              packs={packs}
              saveRequest={saveRequest}
              onSave={save}
              onLoad={load}
              onClone={clone}
            />
          </div>
        </main>
      ) : (
        !loadError && <p className="p-6 text-sm text-fg-3">Loading content…</p>
      )}

      <AgentDrawer />
    </div>
  );
}

/** Loader problems, collapsed to a count until opened: a broken file the
 *  agent just wrote should be impossible to miss and easy to ignore. */
function ProblemsStrip({ problems }: { problems: Problem[] }) {
  const errors = problems.filter((p) => p.level === "error").length;
  const warnings = problems.length - errors;
  const tone = errors ? "bg-err-soft text-err" : "bg-warn-soft text-warn";
  const parts = [errors && `${errors} error${errors === 1 ? "" : "s"}`, warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`].filter(Boolean);
  return (
    <details className={`px-4 py-2 text-sm ${tone}`} data-testid="problems">
      <summary className="cursor-pointer select-none">Content problems: {parts.join(", ")}</summary>
      <ul className="mt-2 flex flex-col gap-1 pb-1">
        {problems.map((p) => (
          <li key={`${p.file}:${p.message}`}>
            <span className="font-medium">{p.level}</span> <code className="font-mono text-xs">{p.file}</code>: {p.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
