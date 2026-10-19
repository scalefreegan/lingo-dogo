import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, assemblePack, createFolder, deleteFolder, deletePack, getContent, listPacks, movePack, renamePack, savePack, saveProfile,
} from "./api";
import type { AssembleResult, Committed, ContentReply, Pack, PackInput, PacksReply, Problem, ProfileRequest } from "./types";
import {
  draftToPack, emptyOverrides, formatSessionLine, joinPackId, loadRememberedDraft, localTimestamp, newDraft, packId, packToDraft, rememberDraft,
  sessionValues, splitPackId, type Draft,
} from "./draft";
import TopBar from "./components/TopBar";
import SummaryBar from "./components/SummaryBar";
import SceneTab from "./components/SceneTab";
import CustomizeTab from "./components/CustomizeTab";
import GoTab from "./components/GoTab";
import LibraryTab from "./components/LibraryTab";
import AgentDrawer from "./components/AgentDrawer";
import type { PackStatus, SaveOutcome, Tab } from "./components/shared";

/** Debounce for the live preview: long enough to coalesce typing in the
 *  notes box, short enough that a checkbox feels immediate. */
const ASSEMBLE_DELAY_MS = 200;

const TAB_KEY = "lingo-dojo.tab.v1";

function isTab(v: string | null): v is Tab {
  return v === "scene" || v === "customize" || v === "go" || v === "library";
}

/** The last tab this browser was on — "Scene" the first time, or if storage
 *  is blocked or holds something unrecognized. */
function loadRememberedTab(): Tab {
  try {
    const raw = localStorage.getItem(TAB_KEY);
    return isTab(raw) ? raw : "scene";
  } catch {
    return "scene";
  }
}

export default function App() {
  const [content, setContent] = useState<ContentReply | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  // The one-line outcome of the last pack action (save, move, rename, delete,
  // folder), with the commit that recorded it.
  const [packStatus, setPackStatus] = useState<PackStatus | null>(null);
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
  const [saveRequest, setSaveRequest] = useState<{ title: string; folder: string; seq: number } | null>(null);
  const [tab, setTabState] = useState<Tab>(loadRememberedTab);

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* private window or blocked storage: the next visit just starts on Scene */
    }
  }, []);

  const applyLoad = useCallback((c: ContentReply, p: PacksReply) => {
    setContent(c);
    setPacks(p.packs);
    setFolders(p.folders);
    setLoadError(null);
    setContentVersion((v) => v + 1);
    // The first load restores the last draft this browser had (so a refresh
    // keeps today's picks), else starts from the library's defaults; later
    // reloads keep the draft (a unit that vanished shows up as a warning).
    setDraft((d) => d ?? loadRememberedDraft() ?? newDraft(c));
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

  const learnerLine = useMemo(() => {
    if (!content || !draft) return "";
    return formatSessionLine(sessionValues(draft, content.profile));
  }, [content, draft]);

  /** Re-list after any pack write, so the library shows what is on disk. */
  async function refreshPacks() {
    const p = await listPacks();
    setPacks(p.packs);
    setFolders(p.folders);
  }

  /** The status line after a pack write: what happened and the commit that
   *  recorded it — or that git did not, which deserves a look at the terminal. */
  function report(what: string, c: Committed): PackStatus {
    if (c.error) return { tone: "err", text: `${what} — ${c.error}` };
    return { tone: "ok", text: c.commit ? `${what} (committed ${c.commit.hash})` : `${what} (nothing to commit)` };
  }

  /** Run a pack action, then re-list and show the outcome either way.
   *  Resolves to whether it succeeded, so an inline form knows to close. */
  async function act(run: () => Promise<PackStatus>): Promise<boolean> {
    try {
      const status = await run();
      await refreshPacks();
      setPackStatus(status);
      return true;
    } catch (e) {
      setPackStatus({ tone: "err", text: e instanceof ApiError ? e.message : String(e) });
      return false;
    }
  }

  async function save(title: string, folder: string, overwrite: boolean): Promise<SaveOutcome> {
    if (!draft || !pack) return { ok: false, error: "nothing to save" };
    // Same title and folder as the pack it was loaded from → update that file
    // in place; a new title or folder is a new file named for today.
    const src = draft.sourceId;
    const id = src != null && title === draft.title && folder === splitPackId(src).folder ? src : joinPackId(folder, packId(title));
    if (!overwrite && id !== src && packs.some((p) => p.id === id)) return { ok: false, conflict: id };
    const created = id === src && draft.created ? draft.created : localTimestamp();
    try {
      const r = await savePack(id, { ...pack, title, created });
      setDraft((d) => (d ? { ...d, title: r.pack.title, sourceId: r.pack.id, created: r.pack.created } : d));
      await refreshPacks();
      setPackStatus(report(`Saved ${r.pack.id}`, r));
      return { ok: true, id: r.pack.id };
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : String(e) };
    }
  }

  function move(id: string, folder: string) {
    return act(async () => {
      const r = await movePack(id, folder);
      setDraft((d) => (d && d.sourceId === id ? { ...d, sourceId: r.pack.id } : d));
      return report(`Moved ${id} to ${folder || "no folder"}`, r);
    });
  }

  function rename(id: string, title: string) {
    return act(async () => {
      const r = await renamePack(id, title);
      setDraft((d) => (d && d.sourceId === id ? { ...d, sourceId: r.pack.id, title: r.pack.title } : d));
      return report(`Renamed ${id} to ${r.pack.id}`, r);
    });
  }

  function remove(id: string) {
    return act(async () => {
      const r = await deletePack(id);
      // The draft keeps its content but is no longer "the saved pack": a
      // later save writes a new file rather than quietly resurrecting this one.
      setDraft((d) => (d && d.sourceId === id ? { ...d, sourceId: null } : d));
      return report(`Deleted ${id}`, r);
    });
  }

  function addFolder(name: string) {
    return act(async () => report(`Created folder ${name}`, await createFolder(name)));
  }

  function removeFolder(name: string) {
    return act(async () => report(`Deleted folder ${name}`, await deleteFolder(name)));
  }

  /** "Save as my defaults": write the pickers' values to profile.yaml, reload
   *  so content.profile is the new file, then clear the four overrides — they
   *  are the defaults now, so neither the draft nor a pack saved from it
   *  should repeat them. Resolves to an error sentence, or null. */
  async function saveDefaults(values: ProfileRequest): Promise<string | null> {
    try {
      await saveProfile(values);
    } catch (e) {
      return e instanceof ApiError ? e.message : String(e);
    }
    await reloadContent();
    setDraft((d) => (d ? { ...d, overrides: emptyOverrides() } : d));
    return null;
  }

  /** Load jumps to Scene: that's where the loaded pack's scenario shows up. */
  function load(p: Pack) {
    setDraft(packToDraft(p));
    setSaveRequest(null);
    setTab("scene");
  }

  /** Clone = load under a new title, with the save form open so the copy
   *  gets its own name (in the same folder, until the form says otherwise) —
   *  jumps to Go, where that save form now lives. */
  function clone(p: Pack) {
    const title = `${p.title} (copy)`;
    setDraft({ ...packToDraft(p), title, sourceId: null, created: "" });
    setSaveRequest((r) => ({ title, folder: p.folder, seq: (r?.seq ?? 0) + 1 }));
    setTab("go");
  }

  // Remember every change; "New pack" below is the way back to the defaults.
  useEffect(() => {
    if (draft) rememberDraft(draft);
  }, [draft]);

  function startNew() {
    if (!content) return;
    setDraft(newDraft(content));
    setSaveRequest(null);
    setTab("scene");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar tab={tab} onTab={setTab} onNewPack={startNew} onReload={() => void reloadContent()} reloading={reloading} ready={!!content} />
      {content && draft && pack && (
        <SummaryBar content={content} draft={draft} pack={pack} sceneTitle={scenarioTitle} result={result} pending={assembling} onTab={setTab} />
      )}

      {loadError && <p className="bg-err-soft px-4 py-2 text-sm text-err">Could not load content: {loadError}</p>}
      {content && content.problems.length > 0 && <ProblemsStrip problems={content.problems} />}

      {content && draft && pack ? (
        <main className="flex-1 p-4">
          <div className="mx-auto flex w-full max-w-3xl flex-col">
            {tab === "scene" && (
              <SceneTab content={content} draft={draft} onChange={setDraft} onSaveDefaults={saveDefaults} onNext={() => setTab("customize")} />
            )}
            {tab === "customize" && <CustomizeTab content={content} draft={draft} onChange={setDraft} onNext={() => setTab("go")} />}
            {tab === "go" && (
              <GoTab
                content={content}
                pack={pack}
                title={draft.title}
                sourceId={draft.sourceId}
                sceneTitle={scenarioTitle}
                learnerLine={learnerLine}
                exportId={draft.sourceId ? splitPackId(draft.sourceId).stem : packId(draft.title || scenarioTitle || "session")}
                result={result}
                pending={assembling}
                error={assembleError}
                folders={folders}
                packStatus={packStatus}
                saveRequest={saveRequest}
                onSave={save}
              />
            )}
            {tab === "library" && (
              <LibraryTab
                packs={packs}
                folders={folders}
                content={content}
                currentId={draft.sourceId}
                onLoad={load}
                onClone={clone}
                onMove={move}
                onRename={rename}
                onDelete={remove}
                onCreateFolder={addFolder}
                onDeleteFolder={removeFolder}
              />
            )}
          </div>
        </main>
      ) : (
        !loadError && <p className="p-6 text-sm text-fg-3">Loading content…</p>
      )}

      <AgentDrawer onContentChanged={reloadContent} />
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
