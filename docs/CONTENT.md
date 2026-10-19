# Content format contract

Everything the app composes lives under `content/` as plain text. This file is the
contract shared by the loader (`scripts/content.mjs`), the assembler
(`scripts/assemble.mjs`), the seed library, the UI, and the embedded agent. Change
the format here first, then the code.

Frontmatter is YAML between `---` lines. Parse with the `yaml` npm package (not
gray-matter; the split is trivial and we want one YAML dependency). Unknown
frontmatter keys are preserved and ignored, never an error. Missing required keys
are a validation error reported with the file path.

## `content/schema.yaml` — the slots

```yaml
version: 1
slots:
  - id: intro
    title: Introduction
    pick: one          # exactly one unit (if required) or at most one
    required: true
    description: How the session opens and in which language.
  - id: warmup
    title: Warm-up
    pick: any          # zero or more units
    required: false
    description: Optional drills before the scenario starts.
  # ... in prompt order
```

- Slot order in this list **is** the order sections appear in the export.
- `pick: one` renders as radio buttons; `pick: any` as checkboxes.
- `required: true` with `pick: one` means the pack must select one unit for the
  slot; the assembler returns a warning (not an error) when it is missing and
  renders the section with a placeholder line so the export is never silently
  incomplete.
- The agent may add a slot by editing this file. A unit whose `slot` is not in the
  schema is loaded with a validation warning and shown in an "Unslotted" group.

## `content/units/<id>.md` — a unit

```markdown
---
id: correct-gently            # must equal the filename stem
slot: corrections             # a slot id from schema.yaml
title: Gentle in-line corrections
summary: Finish the beat, then offer a more natural phrasing once.
tags: [corrections, beginner-friendly]
default: true                 # preselected in a new pack (optional, default false)
level: [A1, A2, B1]           # optional hint; UI shows a badge, never filters
---
When the learner makes an error, do not interrupt mid-sentence. Finish the
beat of the conversation, then briefly offer a more natural phrasing in
{{target_language}}, say it once, and continue the scene. Do not explain
grammar unless the learner asks.
```

- The body is written as **instructions to the dojo master**, in English, second
  person ("you"). Keep each unit self-contained: no references to other units.
- Body may use these placeholders, substituted at assembly time:
  `{{learner_name}}`, `{{native_language}}`, `{{target_language}}`,
  `{{target_variant}}`, `{{level}}`, `{{scenario_title}}`. Unknown placeholders
  are left as-is and reported as a warning.
- `id` is kebab-case and unique across units. Filename is `<id>.md`.

## `content/scenarios/<id>.md` — a scenario

```markdown
---
id: oaxaca-palenque
title: Mezcal tasting at a palenque
summary: Visiting a small family palenque near Santiago Matatlán.
tags: [oaxaca, mezcal, travel]
language: es-MX               # suggested target variant; profile can override
roles:
  dojo_master: the maestro mezcalero, Don Eulogio, 60s, warm, proud of his craft
  learner: a curious visitor on a first trip to Oaxaca
beats:                        # optional ordered scene sections the dojo master may use
  - Arrival and greeting at the gate
  - Walking past the horno and tahona; how the agave is cooked and crushed
  - Tasting three mezcales; describing flavor
  - Asking about buying a bottle; prices; saying goodbye
vocab:                        # optional; warm-up units draw from this
  - { term: "palenque", gloss: "mezcal distillery" }
  - { term: "¿Me permite probar?", gloss: "May I try it?" }
---
The learner arrives at the palenque in the late morning... (free prose for the
dojo master: setting, mood, what the learner is trying to accomplish, what
success looks like.)
```

Only `id`, `title`, `summary` are required. Everything else is optional.

## `content/profile.yaml` — the learner

```yaml
learner_name: Aaron
native_language: English
target_language: Spanish
target_variant: Mexican Spanish (Oaxaca)
level: A2            # CEFR; free text accepted
goals: Hold a relaxed conversation while traveling; understand fast replies.
notes: Prefers to be corrected, not coddled.
```

## `content/packs/<date>-<slug>.yaml` — a saved pack

```yaml
title: Palenque visit, gentle corrections
created: 2026-10-19T09:30:00-06:00
scenario: oaxaca-palenque        # a scenario id, OR:
quick_scenario: ""               # free text used instead of a scenario file
units:                           # unit ids; order within a slot follows the pack
  - intro-native
  - warmup-vocab
  - whole-sentences
  - guidance-target
  - correct-gently
  - debrief-top-three
overrides:                       # optional, any profile key
  level: B1
notes: |
  Today I'd like extra practice with prices and numbers.
```

The filename is `<created date YYYY-MM-DD>-<slug of title>.yaml`. The pack's `id`
is the filename stem.

## `content/frame.md` — the fixed preamble

Plain markdown (no frontmatter) placed at the top of every export. It establishes
the dojo-master role and the fixed rules (stay in the voice session, keep turns
short for speech, etc.). It may use the same placeholders as units.

## Assembly algorithm (`scripts/assemble.mjs`)

Input: loaded content + one pack. Output: `{ markdown, warnings[], stats }`.

1. Resolve the effective profile: `profile.yaml` merged with `pack.overrides`.
2. Resolve the scenario: by id, or `quick_scenario` text as an ad hoc scenario with
   title "Quick scenario".
3. Walk `schema.slots` in order. For each slot, take the pack's units with that
   slot, in pack order. Apply cardinality: `one` with >1 is a warning (keep the
   first); `required` with 0 is a warning and a placeholder line.
4. Render, in this order:
   - `# Lingo Dojo session: <scenario title>`
   - `frame.md` body (placeholders substituted)
   - `## Learner` — a short block from the effective profile
   - `## Scenario` — title, summary, roles, beats, vocab table (if present), body
   - One `## <slot title>` per slot that has units, each unit rendered as
     `### <unit title>` + body (placeholders substituted). Slots with no units are
     omitted unless required.
   - `## Notes from the learner` — `pack.notes`, omitted if empty
5. `stats`: word count and approximate token count (words × 1.3).

Rendering must be deterministic: same inputs, byte-identical output. Unit bodies
are included verbatim apart from placeholder substitution and trimmed trailing
whitespace.
