import type { ContentReply } from "../types";
import { OVERRIDE_FIELDS, type Draft, type OverrideKey } from "../draft";
import { Badge, Card, ColumnHeading, inputClass } from "./ui";

/* Left column: what the session is about (a library scenario or a quick
 * one), and who it is for this time (profile overrides, notes). */
export default function ScenarioColumn({
  content,
  draft,
  onChange,
}: {
  content: ContentReply;
  draft: Draft;
  onChange: (d: Draft) => void;
}) {
  const quick = draft.scenarioMode === "quick";
  const setOverride = (key: OverrideKey, value: string) => onChange({ ...draft, overrides: { ...draft.overrides, [key]: value } });

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

      <Card>
        <h3 className="text-sm font-medium text-fg">This session</h3>
        <p className="mt-0.5 text-xs text-fg-3">Leave blank to use content/profile.yaml.</p>
        <div className="mt-3 flex flex-col gap-2.5">
          {OVERRIDE_FIELDS.map(({ key, label }) => {
            const fromProfile = content.profile[key];
            return (
              <label key={key} className="flex flex-col gap-1 text-xs text-fg-2">
                {label}
                <input
                  className={inputClass}
                  value={draft.overrides[key]}
                  placeholder={typeof fromProfile === "string" && fromProfile ? fromProfile : "—"}
                  onChange={(e) => setOverride(key, e.target.value)}
                />
              </label>
            );
          })}
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
    </div>
  );
}
