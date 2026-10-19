import { useMemo, useState } from "react";
import type { ContentReply, ProfileRequest } from "../types";
import {
  LEVELS, OVERRIDE_FIELDS, choosePickerValue, fold, formatSessionLine, profileDefault, profileValue, sessionValues, type Draft, type OverrideKey,
} from "../draft";
import { Button, Card, inputClass } from "./ui";

const FILTER_KEY = "lingo-dojo.scene-filter.v1";
/** Chip order; any other category a scenario uses follows alphabetically. */
const CATEGORY_ORDER = ["Food & drink", "Getting around", "Shopping", "Outdoors & sport", "Culture & guides", "Lodging & logistics", "Health & help"];
const OTHER_SCENES = "Other scenes";

interface Filter {
  query: string;
  /** "" = All. */
  category: string;
}

function loadFilter(): Filter {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null") as Partial<Filter> | null;
    return { query: typeof f?.query === "string" ? f.query : "", category: typeof f?.category === "string" ? f.category : "" };
  } catch {
    return { query: "", category: "" };
  }
}

/* Scene tab: what the session is about (a library scenario or a quick one),
 * who it is for (the learner line, collapsed until you ask to change it),
 * and an optional note — set once, then move on to Customize. The scenes get
 * the wide column (search, category chips, grouped grid); the learner and
 * note sit in a sticky side column on desktop. */
export default function SceneTab({
  content,
  draft,
  onChange,
  onSaveDefaults,
  onNext,
}: {
  content: ContentReply;
  draft: Draft;
  onChange: (d: Draft) => void;
  /** Writes the shown picker values to profile.yaml; resolves to an error
   *  sentence, or null when the profile (and the draft) now reflect them. */
  onSaveDefaults: (values: ProfileRequest) => Promise<string | null>;
  onNext: () => void;
}) {
  const quick = draft.scenarioMode === "quick";
  const { scenarios } = content;
  const [filter, setFilterState] = useState<Filter>(loadFilter);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(f));
    } catch {
      /* blocked storage: the filter just won't survive a refresh */
    }
  };
  const clear = () => setFilter({ query: "", category: "" });

  const categories = useMemo(() => {
    const present = new Set(scenarios.map((s) => s.category).filter((c): c is string => !!c));
    const known = CATEGORY_ORDER.filter((c) => present.has(c));
    return [...known, ...[...present].filter((c) => !CATEGORY_ORDER.includes(c)).sort((a, b) => a.localeCompare(b))];
  }, [scenarios]);
  // A remembered chip for a category that no longer exists must not hide everything.
  const category = categories.includes(filter.category) ? filter.category : "";
  const needle = fold(filter.query.trim());

  // Chip counts follow the search text, so they say what clicking would show.
  const searched = useMemo(
    () => scenarios.filter((s) => !needle || fold([s.title, s.summary, s.category ?? "", ...s.tags].join(" ")).includes(needle)),
    [scenarios, needle],
  );
  const visible = category ? searched.filter((s) => s.category === category) : searched;
  const groups = useMemo(() => {
    const by = new Map<string, typeof visible>();
    for (const s of visible) by.set(s.collection ?? "", [...(by.get(s.collection ?? "") ?? []), s]);
    return [...by.entries()]
      .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
      .map(([name, items]) => ({ name: name || OTHER_SCENES, items }));
  }, [visible]);

  const filtering = needle !== "" || category !== "";
  const selected = quick ? undefined : scenarios.find((s) => s.id === draft.scenario);
  const hiddenSelected = selected && !visible.some((s) => s.id === selected.id) ? selected : undefined;
  const pick = (id: string) => onChange({ ...draft, scenarioMode: "library", scenario: id });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {scenarios.length === 0 ? (
            <p className="text-sm text-fg-3">No scenarios in content/scenarios yet.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                  <input
                    type="search"
                    aria-label="Search scenes"
                    className={`${inputClass} max-w-sm`}
                    placeholder="Search scenes…"
                    value={filter.query}
                    onChange={(e) => setFilter({ ...filter, query: e.target.value })}
                  />
                  {filtering && (
                    <button type="button" className="text-sm text-fg-3 hover:text-fg-2 hover:underline" onClick={clear}>
                      Clear
                    </button>
                  )}
                </div>
                {categories.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
                    <Chip label="All" count={searched.length} active={category === ""} onClick={() => setFilter({ ...filter, category: "" })} />
                    {categories.map((c) => (
                      <Chip
                        key={c}
                        label={c}
                        count={searched.filter((s) => s.category === c).length}
                        active={category === c}
                        onClick={() => setFilter({ ...filter, category: c })}
                      />
                    ))}
                  </div>
                )}
              </div>
              {hiddenSelected && (
                <p className="text-sm text-fg-2" data-testid="hidden-selected">
                  Selected: <span className="font-medium text-fg">{hiddenSelected.title}</span> (hidden by filter) ·{" "}
                  <button type="button" className="text-accent hover:underline" onClick={clear}>
                    Clear filters
                  </button>
                </p>
              )}
            </>
          )}

          <div className={GRID}>
            <QuickSceneCard
              selected={quick}
              value={draft.quickScenario}
              onSelect={() => onChange({ ...draft, scenarioMode: "quick" })}
              onChangeText={(text) => onChange({ ...draft, quickScenario: text, scenarioMode: "quick" })}
              className={quick ? "col-span-full" : ""}
            />
          </div>

          {scenarios.length > 0 && visible.length === 0 && (
            <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-fg-2">
              <p className="font-medium text-fg">No scenes match</p>
              <button type="button" className="mt-1 text-accent hover:underline" onClick={clear}>
                Clear filters
              </button>
            </div>
          )}

          {groups.map((g) => (
            <section key={g.name} aria-label={g.name} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-fg">
                {g.name} <span className="font-normal text-fg-3">· {g.items.length}</span>
              </h3>
              <div className={GRID}>
                {g.items.map((s) => (
                  <ScenarioCard
                    key={s.id}
                    title={s.title}
                    summary={s.summary}
                    category={s.category}
                    selected={!quick && draft.scenario === s.id}
                    onClick={() => pick(s.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-28">
          <LearnerCard content={content} draft={draft} onChange={onChange} onSaveDefaults={onSaveDefaults} />
          <NotesDisclosure draft={draft} onChange={onChange} />
        </aside>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Next: Customize →
        </Button>
      </div>
    </div>
  );
}

/** 4 columns at desktop width, down to 1 on a phone. */
const GRID = "grid grid-cols-1 gap-2.5 sm:grid-cols-2 min-[1000px]:grid-cols-3 min-[1300px]:grid-cols-4";

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active ? "border-accent bg-accent-soft text-accent" : "border-line bg-panel text-fg-2 hover:border-line-strong"
      }`}
    >
      {label} <span className={active ? "" : "text-fg-3"}>{count}</span>
    </button>
  );
}

function ScenarioCard({
  title,
  summary,
  category,
  selected,
  onClick,
}: {
  title: string;
  summary: string;
  category: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-w-0 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-strong"
      }`}
    >
      <span className="line-clamp-2 text-sm leading-snug font-medium text-fg">{title}</span>
      <p className="w-full truncate text-xs text-fg-2">{summary}</p>
      {category && <span className="mt-0.5 text-[11px] text-fg-3">{category}</span>}
    </button>
  );
}

/** Collapsed, it's just a card inviting a free-text scene; selecting it (or
 *  typing) expands the same card to hold the textarea. */
function QuickSceneCard({
  selected,
  value,
  onSelect,
  onChangeText,
  className = "",
}: {
  selected: boolean;
  value: string;
  onSelect: () => void;
  onChangeText: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border p-3 transition-colors ${
        selected ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-strong"
      } ${className}`}
    >
      <button type="button" aria-pressed={selected} onClick={onSelect} className="text-left text-sm font-medium text-fg">
        Quick scene
      </button>
      {selected ? (
        <textarea
          autoFocus
          aria-label="Quick scene"
          className={`${inputClass} min-h-24`}
          placeholder="Ordering tacos al pastor at a street stand at 1 a.m.…"
          value={value}
          onChange={(e) => onChangeText(e.target.value)}
        />
      ) : (
        <p className="truncate text-xs text-fg-2">Describe a scene in your own words.</p>
      )}
    </div>
  );
}

/* "Learner": the profile keys a pack may override, collapsed to one line
 * until Edit is pressed. Same rules as before — picking the profile's own
 * value clears the override, so a saved pack carries only what differs from
 * content/profile.yaml. */
function LearnerCard({
  content,
  draft,
  onChange,
  onSaveDefaults,
}: {
  content: ContentReply;
  draft: Draft;
  onChange: (d: Draft) => void;
  onSaveDefaults: (values: ProfileRequest) => Promise<string | null>;
}) {
  const { profile, languages } = content;
  const session = sessionValues(draft, profile);
  const pickers = languages.length > 0;
  const choose = (key: OverrideKey, value: string) => onChange(choosePickerValue(draft, profile, languages, key, value));
  const setOverride = (key: OverrideKey, value: string) => onChange({ ...draft, overrides: { ...draft.overrides, [key]: value } });
  const fallback = (key: OverrideKey) =>
    key === "native_language" ? profileValue(profile, key) || "English" : profileDefault(profile, key, session.target_language);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const dirty = OVERRIDE_FIELDS.some(({ key }) => session[key] !== profileValue(profile, key));

  async function saveDefaults() {
    setSaving(true);
    setSaveMessage(null);
    const error = await onSaveDefaults(session);
    setSaving(false);
    setSaveMessage(error ? { tone: "err", text: error } : { tone: "ok", text: "Saved to content/profile.yaml" });
  }

  const names = languages.map((l) => l.name);
  const variants = languages.find((l) => l.name === session.target_language)?.variants ?? [];
  // "(none)" is offered only when choosing it does something — see draft.ts.
  const noneReachable = profileDefault(profile, "target_variant", session.target_language) === "";
  const variantOptions = noneReachable ? ["", ...variants] : variants;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-fg">Learner</h3>
          <p className="mt-0.5 text-sm text-fg-2">{formatSessionLine(session) || "Not set"}</p>
        </div>
        <Button variant="ghost" className="text-xs" aria-expanded={editing} onClick={() => setEditing((e) => !e)}>
          {editing ? "Done" : "Edit"}
        </Button>
      </div>
      {editing && (
        <div className="flex flex-col gap-2.5 border-t border-line pt-3">
          {pickers ? (
            <>
              <Picker label="Native language" value={session.native_language} options={names} onChange={(v) => choose("native_language", v)} />
              <Picker label="Target language" value={session.target_language} options={names} onChange={(v) => choose("target_language", v)} />
              {variants.length === 0 && !session.target_variant ? (
                <Picker label="Variant" value="" options={[""]} emptyLabel="No variants" disabled onChange={() => {}} />
              ) : (
                <Picker
                  label="Variant"
                  value={session.target_variant}
                  options={variantOptions}
                  emptyLabel="(none)"
                  onChange={(v) => choose("target_variant", v)}
                />
              )}
              <Picker label="Level" value={session.level} options={LEVELS} onChange={(v) => choose("level", v)} />
            </>
          ) : (
            OVERRIDE_FIELDS.map(({ key, label }) => (
              <label key={key} className="flex flex-col gap-1 text-xs text-fg-2">
                {label}
                <input className={inputClass} value={draft.overrides[key]} placeholder={fallback(key) || "—"} onChange={(e) => setOverride(key, e.target.value)} />
              </label>
            ))
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void saveDefaults()} disabled={!dirty || saving} title="Write these four values to content/profile.yaml">
              {saving ? "Saving…" : "Save as my defaults"}
            </Button>
            {saveMessage && (
              <span className={`text-xs ${saveMessage.tone === "ok" ? "text-accent" : "text-err"}`} data-testid="profile-message">
                {saveMessage.text}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** A <select> whose shown value is always true: a value outside `options`
 *  (a profile entry languages.yaml doesn't list, or nothing at all) is
 *  prepended rather than snapped to the first option. "" shows as `emptyLabel`. */
function Picker({
  label,
  value,
  options,
  onChange,
  disabled = false,
  emptyLabel = "—",
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const shown = options.includes(value) ? options : [value, ...options];
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-2">
      {label}
      <select className={inputClass} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {shown.map((o) => (
          <option key={o} value={o}>
            {o || emptyLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Collapsed behind a button until there's something to say (or it's loaded
 *  with a note already) — a textarea nobody's going to use is pure clutter. */
function NotesDisclosure({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const [open, setOpen] = useState(draft.notes.trim().length > 0);
  if (!open) {
    return (
      <button type="button" className="self-start text-sm text-fg-3 hover:text-fg-2 hover:underline" onClick={() => setOpen(true)}>
        Add a note for the dojo master
      </button>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm text-fg-2">
      Note for the dojo master
      <textarea
        autoFocus
        className={`${inputClass} min-h-20`}
        placeholder="Today I'd like extra practice with prices and numbers."
        value={draft.notes}
        onChange={(e) => onChange({ ...draft, notes: e.target.value })}
      />
    </label>
  );
}
