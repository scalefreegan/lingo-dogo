import { useState } from "react";
import type { ContentReply, ProfileRequest } from "../types";
import {
  LEVELS, OVERRIDE_FIELDS, choosePickerValue, profileDefault, profileValue, sessionValues, type Draft, type OverrideKey,
} from "../draft";
import { Badge, Button, Card, ColumnHeading, inputClass } from "./ui";

/* Left column: what the session is about (a library scenario or a quick
 * one), and who it is for this time (profile overrides, notes). */
export default function ScenarioColumn({
  content,
  draft,
  onChange,
  onSaveDefaults,
}: {
  content: ContentReply;
  draft: Draft;
  onChange: (d: Draft) => void;
  /** Writes the shown picker values to profile.yaml; resolves to an error
   *  sentence, or null when the profile (and the draft) now reflect them. */
  onSaveDefaults: (values: ProfileRequest) => Promise<string | null>;
}) {
  const quick = draft.scenarioMode === "quick";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <ColumnHeading>Scenario</ColumnHeading>
        {content.scenarios.length === 0 && <p className="text-sm text-fg-3">No scenarios in content/scenarios yet.</p>}
        <ul className="flex flex-col gap-2" aria-label="Scenarios">
          {content.scenarios.map((s) => {
            const selected = !quick && draft.scenario === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onChange({ ...draft, scenarioMode: "library", scenario: s.id })}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected ? "border-accent bg-accent-soft" : "border-line bg-panel hover:border-line-strong"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-fg">{s.title}</span>
                    {s.language && <Badge>{s.language}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-fg-2">{s.summary}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <Card className={quick ? "border-accent" : ""}>
        <label className="flex items-center gap-2 text-sm font-medium text-fg">
          <input
            type="checkbox"
            checked={quick}
            onChange={(e) => onChange({ ...draft, scenarioMode: e.target.checked ? "quick" : "library" })}
          />
          Quick scenario
        </label>
        <p className="mt-1 text-xs text-fg-3">Describe a scene in your own words instead of picking one above.</p>
        <textarea
          aria-label="Quick scenario"
          className={`${inputClass} mt-2 min-h-24`}
          placeholder="Ordering tacos al pastor at a street stand at 1 a.m.…"
          value={draft.quickScenario}
          // Typing here is choosing the quick scenario; clicking a library
          // card switches back without losing the text.
          onChange={(e) => onChange({ ...draft, quickScenario: e.target.value, scenarioMode: "quick" })}
        />
      </Card>

      <SessionCard content={content} draft={draft} onChange={onChange} onSaveDefaults={onSaveDefaults} />
    </div>
  );
}

/* "This session": the profile keys a pack may override. With languages.yaml
 * loaded these are pickers whose shown value is always what the prompt will
 * use (the override, else the profile), so the preview and the controls
 * never disagree; picking the profile's own value clears the override, and
 * a saved pack carries only what differs. Without languages.yaml they are
 * the original free-text fields, blank meaning "use the profile". */
function SessionCard({
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
  // What a blank field means, for the free-text placeholders.
  const fallback = (key: OverrideKey) =>
    key === "native_language" ? profileValue(profile, key) || "English" : profileDefault(profile, key, session.target_language);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // Nothing to save while every shown value is what profile.yaml already says.
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
  // "(none)" is offered only when choosing it does something: under the
  // profile's own target, clearing the override brings the profile's variant
  // back, so the honest default option there is that variant, not an empty
  // one that would snap back as soon as it was picked.
  const noneReachable = profileDefault(profile, "target_variant", session.target_language) === "";
  const variantOptions = noneReachable ? ["", ...variants] : variants;

  return (
    <Card>
      <h3 className="text-sm font-medium text-fg">This session</h3>
      <p className="mt-0.5 text-xs text-fg-3">
        {pickers ? "Changes apply to this pack only, until you save them as defaults." : "Leave blank to use content/profile.yaml."}
      </p>
      <div className="mt-3 flex flex-col gap-2.5">
        {pickers ? (
          <>
            <Picker label="Native language" value={session.native_language} options={names} onChange={(v) => choose("native_language", v)} />
            <Picker label="Target language" value={session.target_language} options={names} onChange={(v) => choose("target_language", v)} />
            {variants.length === 0 && !session.target_variant ? (
              <Picker label="Variant" value="" options={[""]} emptyLabel="No variants" disabled onChange={() => {}} />
            ) : (
              <Picker label="Variant" value={session.target_variant} options={variantOptions} emptyLabel="(none)" onChange={(v) => choose("target_variant", v)} />
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
        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Notes for the dojo master
          <textarea
            className={`${inputClass} min-h-20`}
            placeholder="Today I'd like extra practice with prices and numbers."
            value={draft.notes}
            onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          />
        </label>
      </div>
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
