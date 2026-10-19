/* The pack being edited, and the pure rules for changing it. Kept apart from
 * the components so the selection rules (defaults, cardinality, unit order)
 * live in one place and read like the contract they implement
 * (docs/CONTENT.md: "order within a slot follows the pack"). */

import type { ContentReply, Pack, PackInput, Slot, Unit } from "./types";

export type OverrideKey = "target_language" | "target_variant" | "level";
export const OVERRIDE_FIELDS: { key: OverrideKey; label: string }[] = [
  { key: "target_language", label: "Target language" },
  { key: "target_variant", label: "Variant" },
  { key: "level", label: "Level" },
];

export interface Draft {
  /** "" until saved or loaded. */
  title: string;
  /** The saved pack this draft came from; saving with the same title
   *  overwrites it. Null for a new or cloned draft. */
  sourceId: string | null;
  /** Kept from a loaded pack so an overwrite doesn't rewrite its date. */
  created: string;
  /** "library" uses `scenario`; "quick" uses `quickScenario`. Both are kept
   *  so flipping between them doesn't lose what was typed. */
  scenarioMode: "library" | "quick";
  scenario: string;
  quickScenario: string;
  /** Unit ids, pack order. */
  units: string[];
  overrides: Record<OverrideKey, string>;
  notes: string;
  /** Overrides from a loaded pack that the form has no field for; written
   *  back untouched on save. */
  extraOverrides: Record<string, unknown>;
}

const emptyOverrides = (): Record<OverrideKey, string> => ({ target_language: "", target_variant: "", level: "" });

/** A new pack: each slot's `default: true` units preselected, in schema
 *  order. A pick:one slot keeps only its first default, so a fresh pack never
 *  starts with a cardinality warning. */
export function newDraft(content: ContentReply): Draft {
  const units: string[] = [];
  for (const slot of content.schema.slots) {
    const defaults = unitsForSlot(content, slot.id).filter((u) => u.default);
    units.push(...(slot.pick === "one" ? defaults.slice(0, 1) : defaults).map((u) => u.id));
  }
  return {
    title: "",
    sourceId: null,
    created: "",
    scenarioMode: "library",
    scenario: "",
    quickScenario: "",
    units,
    overrides: emptyOverrides(),
    notes: "",
    extraOverrides: {},
  };
}

export function unitsForSlot(content: ContentReply, slotId: string): Unit[] {
  return content.units.filter((u) => u.slot === slotId);
}

/** Units whose slot the schema doesn't have: shown, never selectable (the
 *  assembler would skip them anyway). */
export function unslottedUnits(content: ContentReply): Unit[] {
  const ids = new Set(content.schema.slots.map((s) => s.id));
  return content.units.filter((u) => !ids.has(u.slot));
}

/** pick:one — replace whatever this slot had, in its old position (so the
 *  pack's order elsewhere is undisturbed); `null` clears the slot. */
export function chooseOne(draft: Draft, content: ContentReply, slot: Slot, unitId: string | null): Draft {
  const inSlot = new Set(unitsForSlot(content, slot.id).map((u) => u.id));
  const at = draft.units.findIndex((id) => inSlot.has(id));
  const rest = draft.units.filter((id) => !inSlot.has(id));
  if (unitId) rest.splice(at === -1 ? rest.length : at, 0, unitId);
  return { ...draft, units: rest };
}

/** pick:any — a newly checked unit goes to the end, so the order within the
 *  slot is the order the person ticked them. */
export function toggleAny(draft: Draft, unitId: string, on: boolean): Draft {
  const without = draft.units.filter((id) => id !== unitId);
  return { ...draft, units: on ? [...without, unitId] : without };
}

/** The pack the server sees (assemble, export, save). */
export function draftToPack(draft: Draft): PackInput {
  const overrides: Record<string, unknown> = { ...draft.extraOverrides };
  for (const { key } of OVERRIDE_FIELDS) {
    const v = draft.overrides[key].trim();
    if (v) overrides[key] = v;
  }
  const quick = draft.scenarioMode === "quick";
  return {
    title: draft.title,
    created: draft.created,
    scenario: quick ? "" : draft.scenario,
    quick_scenario: quick ? draft.quickScenario : "",
    units: draft.units,
    overrides,
    notes: draft.notes,
  };
}

export function packToDraft(pack: Pack): Draft {
  const overrides = emptyOverrides();
  const extraOverrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pack.overrides ?? {})) {
    if (OVERRIDE_FIELDS.some((f) => f.key === k) && v != null) overrides[k as OverrideKey] = String(v);
    else extraOverrides[k] = v;
  }
  const quick = !pack.scenario && !!pack.quick_scenario;
  return {
    title: pack.title,
    sourceId: pack.id,
    created: pack.created,
    scenarioMode: quick ? "quick" : "library",
    scenario: pack.scenario,
    quickScenario: pack.quick_scenario,
    units: [...pack.units],
    overrides,
    notes: pack.notes,
    extraOverrides,
  };
}

/* --------------------------------- ids ---------------------------------- */

/** Lowercase ASCII kebab-case, accents folded ("Café en Oaxaca" →
 *  "cafe-en-oaxaca"); matches the server's id rule. */
export function slugify(s: string): string {
  const slug = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "pack";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in local time — the date a person would write on the file. */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local time with its UTC offset, like the contract's 2026-10-19T09:30:00-06:00. */
export function localTimestamp(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The contract's pack id: `<YYYY-MM-DD>-<slug of title>`. */
export function packId(title: string, d = new Date()): string {
  return `${localDate(d)}-${slugify(title)}`;
}
