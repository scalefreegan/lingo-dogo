import { useState } from "react";
import type { ContentReply, ProfileRequest } from "../types";
import {
  LEVELS, OVERRIDE_FIELDS, choosePickerValue, formatSessionLine, profileDefault, profileValue, sessionValues, type Draft, type OverrideKey,
} from "../draft";
import { Badge, Button, Card, inputClass } from "./ui";

/* Scene tab: what the session is about (a library scenario or a quick one),
 * who it is for (the learner line, collapsed until you ask to change it),
 * and an optional note — set once, then move on to Customize. */
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

  return (
    <div className="flex flex-col gap-6">
      {content.scenarios.length === 0 && <p className="text-sm text-fg-3">No scenarios in content/scenarios yet.</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {content.scenarios.map((s) => (
          <ScenarioCard
            key={s.id}
            title={s.title}
            summary={s.summary}
            language={s.language}
            selected={!quick && draft.scenario === s.id}
            onClick={() => onChange({ ...draft, scenarioMode: "library", scenario: s.id })}
          />
        ))}
        <QuickSceneCard
          selected={quick}
          value={draft.quickScenario}
          onSelect={() => onChange({ ...draft, scenarioMode: "quick" })}
          onChangeText={(text) => onChange({ ...draft, quickScenario: text, scenarioMode: "quick" })}
          className={quick ? "sm:col-span-2 lg:col-span-3" : ""}
        />
      </div>

      <LearnerCard content={content} draft={draft} onChange={onChange} onSaveDefaults={onSaveDefaults} />
      <NotesDisclosure draft={draft} onChange={onChange} />

      <div className="flex justify-end">
        <Button variant="primary" onClick={onNext}>
          Next: Customize →
        </Button>
      </div>
    </div>
  );
}

function ScenarioCard({
  title,
  summary,
  language,
  selected,
  onClick,
}: {
  title: string;
  summary: string;
  language: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-strong"
      }`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="font-medium text-fg">{title}</span>
        {language && <Badge>{language}</Badge>}
      </div>
      <p className="line-clamp-1 text-sm text-fg-2">{summary}</p>
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
      className={`flex flex-col gap-2 rounded-lg border p-3 transition-colors ${
        selected ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-strong"
      } ${className}`}
    >
      <button type="button" aria-pressed={selected} onClick={onSelect} className="text-left font-medium text-fg">
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
        <p className="text-sm text-fg-2">Describe a scene in your own words instead of picking one above.</p>
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
