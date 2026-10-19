import type { ReactNode } from "react";
import type { ContentReply, Slot, Unit } from "../types";
import { chooseOne, toggleAny, unitsForSlot, unslottedUnits, type Draft } from "../draft";
import { Badge, Card, ColumnHeading } from "./ui";

/* Middle column: one card per slot in schema order — radios for pick:one,
 * checkboxes for pick:any — then an "Unslotted" card for units whose slot the
 * schema doesn't know (shown so the agent's mistake is visible, never
 * selectable since the assembler would skip them). */
export default function SlotsColumn({
  content,
  draft,
  onChange,
}: {
  content: ContentReply;
  draft: Draft;
  onChange: (d: Draft) => void;
}) {
  const unslotted = unslottedUnits(content);
  return (
    <div className="flex flex-col gap-4">
      <ColumnHeading>Units</ColumnHeading>
      {content.schema.slots.length === 0 && <p className="text-sm text-fg-3">No slots in content/schema.yaml yet.</p>}
      {content.schema.slots.map((slot) => (
        <SlotCard key={slot.id} slot={slot} units={unitsForSlot(content, slot.id)} draft={draft} onChange={onChange} content={content} />
      ))}
      {unslotted.length > 0 && (
        <Card className="border-dashed" data-slot="unslotted">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-medium text-fg">Unslotted</h3>
            <Badge tone="warn">not in schema</Badge>
          </div>
          <p className="mt-1 text-sm text-fg-2">
            These units name a slot that content/schema.yaml doesn't have, so they are never assembled. Fix the unit's{" "}
            <code className="font-mono text-xs">slot</code> or add the slot to the schema.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {unslotted.map((u) => (
              <li key={u.id} className="rounded-md border border-line p-2.5 opacity-75">
                <UnitText unit={u} extra={<Badge tone="warn">slot: {u.slot}</Badge>} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SlotCard({
  slot,
  units,
  draft,
  content,
  onChange,
}: {
  slot: Slot;
  units: Unit[];
  draft: Draft;
  content: ContentReply;
  onChange: (d: Draft) => void;
}) {
  const one = slot.pick === "one";
  const selected = draft.units.filter((id) => units.some((u) => u.id === id));
  const missing = slot.required && selected.length === 0;
  const name = `slot-${slot.id}`;
  const rowClass = (on: boolean) =>
    `flex cursor-pointer gap-3 rounded-md border p-2.5 transition-colors ${on ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`;

  return (
    <Card data-slot={slot.id} className={missing ? "border-warn" : ""}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium text-fg">{slot.title}</h3>
        <div className="flex gap-1">
          <Badge>{one ? "pick one" : "pick any"}</Badge>
          {slot.required && <Badge tone={missing ? "warn" : "neutral"}>required</Badge>}
        </div>
      </div>
      {slot.description && <p className="mt-1 text-sm text-fg-2">{slot.description}</p>}
      {units.length === 0 && <p className="mt-3 text-sm text-fg-3">No units for this slot yet.</p>}
      <fieldset className="mt-3 flex flex-col gap-2">
        <legend className="sr-only">{slot.title}</legend>
        {one && !slot.required && units.length > 0 && (
          <label className={rowClass(selected.length === 0)}>
            <input type="radio" name={name} className="mt-1" checked={selected.length === 0} onChange={() => onChange(chooseOne(draft, content, slot, null))} />
            <span className="text-sm text-fg-2">None</span>
          </label>
        )}
        {units.map((u) => {
          const on = selected.includes(u.id);
          return (
            <label key={u.id} className={rowClass(on)}>
              {one ? (
                <input type="radio" name={name} className="mt-1" checked={on} onChange={() => onChange(chooseOne(draft, content, slot, u.id))} />
              ) : (
                <input type="checkbox" className="mt-1" checked={on} onChange={(e) => onChange(toggleAny(draft, u.id, e.target.checked))} />
              )}
              <UnitText unit={u} />
            </label>
          );
        })}
      </fieldset>
      {one && selected.length > 1 && (
        <p className="mt-2 text-xs text-warn">This slot takes one unit; only the first is used. Pick one to clear the warning.</p>
      )}
    </Card>
  );
}

function UnitText({ unit, extra }: { unit: Unit; extra?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-fg">{unit.title}</span>
        {unit.level.length > 0 && (
          <Badge tone="accent" title="Suggested level (a hint, not a filter)">
            {unit.level.join(" · ")}
          </Badge>
        )}
      </span>
      <span className="text-sm text-fg-2">{unit.summary}</span>
      {(unit.tags.length > 0 || extra) && (
        <span className="flex flex-wrap gap-1">
          {unit.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {extra}
        </span>
      )}
    </span>
  );
}
