/* The wire: every request and response shape the server and the client both
 * name, declared ONCE. The field names follow docs/CONTENT.md (the file
 * format contract); scripts/content.mjs and scripts/assemble.mjs produce
 * them, and web/server/mjs.d.ts types those modules against this file.
 *
 * Why a third directory rather than the client importing server/*.ts (the
 * Atlas pattern): src/ and server/ are separate tsc projects (tsconfig.app
 * has DOM and vite types, tsconfig.node has node's), so importing a server
 * module from src/ would drag node:http and the untyped .mjs scripts into the
 * app program. Both configs include shared/, so this file must stay types
 * only: no imports, and no runtime values. */

/* -------------------------------- content -------------------------------- */

export type Pick = "one" | "any";

/** One entry of content/schema.yaml `slots`, in prompt order. */
export interface Slot {
  id: string;
  title: string;
  pick: Pick;
  /** Defaults to false when the schema omits it. */
  required: boolean;
  /** "" when the schema omits it. */
  description: string;
  /** Display heading the UI clusters slots under on the Customize tab
   *  (Voices, Teaching style, …); undefined when the schema omits it — the
   *  UI then groups the slot under "Other". */
  group?: string;
}

export interface Schema {
  version?: number;
  slots: Slot[];
}

/** content/units/<id>.md. Unknown frontmatter keys ride along untyped. */
export interface Unit {
  id: string;
  /** A slot id; may name a slot that is not in the schema (an "unslotted"
   *  unit, reported as a warning and never assembled). */
  slot: string;
  title: string;
  summary: string;
  tags: string[];
  /** Preselected in a new pack. */
  default: boolean;
  /** CEFR hint for a badge; never a filter. [] when absent. */
  level: string[];
  body: string;
  /** Repo-relative file path (absolute when outside the repo). */
  path: string;
}

export interface VocabItem {
  term: string;
  gloss: string;
}

/** content/scenarios/<id>.md. Only id/title/summary are required on disk;
 *  the loader fills the rest with empty values. */
export interface Scenario {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  /** Suggested target variant, e.g. "es-MX"; the profile can override. */
  language: string | null;
  /** role key (dojo_master, learner, …) → description */
  roles: Record<string, string>;
  beats: string[];
  vocab: VocabItem[];
  /** Optional complications a variation unit may pick from. */
  twists: string[];
  body: string;
  path: string;
}

/** content/profile.yaml. The keys below are the contract's; any other key
 *  is allowed and rendered in the Learner block. */
export interface Profile {
  learner_name?: string;
  native_language?: string;
  target_language?: string;
  target_variant?: string;
  level?: string;
  goals?: string;
  notes?: string;
  [key: string]: unknown;
}

/** One entry of content/languages.yaml: what the native/target pickers
 *  offer. `variants` is [] when the language has none. */
export interface Language {
  name: string;
  variants: string[];
}

/** A file the loader could not use (`error`: left out of the library) or
 *  used with a caveat (`warning`). Never thrown, always listed. */
export interface Problem {
  file: string;
  level: "error" | "warning";
  message: string;
}

/** GET /api/content — the loader's result minus packs (they have their own
 *  routes), re-read from disk on every call so an agent or editor change shows
 *  up without a restart. */
export interface ContentReply {
  root: string;
  schema: Schema;
  frame: string;
  profile: Profile;
  /** [] when content/languages.yaml is missing; the UI then shows free text. */
  languages: Language[];
  units: Unit[];
  scenarios: Scenario[];
  problems: Problem[];
}

/* -------------------------------- profile -------------------------------- */

/** The profile keys the UI's pickers can write ("Save as my defaults"). */
export type PickerKey = "native_language" | "target_language" | "target_variant" | "level";

/** PUT /api/profile — any subset of the picker keys, strings of at most 80
 *  characters; a blank value removes the key from profile.yaml. Everything
 *  else in the profile (name, goals, notes) is edited in the file. */
export type ProfileRequest = Partial<Record<PickerKey, string>>;

/** The profile as it reads back from disk after the write. */
export interface ProfileReply {
  profile: Profile;
}

/* --------------------------------- packs --------------------------------- */

/** The profile keys a pack may override from the UI. Overrides on disk may
 *  carry any profile key. */
export type Overrides = Partial<Record<PickerKey, string>> & Record<string, unknown>;

/** What a pack file holds (content/packs/<id>.yaml), and the body of PUT
 *  /api/packs/:id and POST /api/assemble. */
export interface PackInput {
  title: string;
  /** ISO timestamp with offset, e.g. 2026-10-19T09:30:00-06:00. */
  created: string;
  /** A scenario id, or "" when quick_scenario is used. */
  scenario: string;
  quick_scenario: string;
  /** Unit ids; order within a slot follows this list. */
  units: string[];
  overrides: Overrides;
  notes: string;
}

/** A saved pack: the file plus its id — the path under content/packs
 *  without .yaml, `<stem>` or `<folder>/<stem>` — and the folder it is in
 *  ("" at the top level). */
export interface Pack extends PackInput {
  id: string;
  folder: string;
}

/** GET /api/packs — packs sorted by id (top-level ones first, by date);
 *  `folders` is every directory under content/packs, an empty one included,
 *  sorted. `problems` are the pack files that failed to load. */
export interface PacksReply {
  packs: Pack[];
  folders: string[];
  problems: Problem[];
}

/** GET /api/packs/:id */
export interface PackReply {
  pack: Pack;
}

/** The git half of a pack write (the server commits content/packs after
 *  each one as `packs: <summary>`). `commit` is null when there was nothing
 *  to commit (an identical save) or when git failed; only the failure sets
 *  `error`. Either way the write itself succeeded — this rides on a 200. */
export interface Committed {
  commit: { hash: string; summary: string } | null;
  error?: string;
}

/** PUT /api/packs/:id, POST /api/packs/:id/move and /rename: the pack as it
 *  reads back from disk (after a move or rename, `pack.id` is the new id). */
export interface PackWriteReply extends PackReply, Committed {}

/** DELETE /api/packs/:id */
export interface PackDeleteReply extends Committed {
  ok: true;
}

/** POST /api/packs/:id/move — "" moves the pack to the top level. 409 when
 *  the destination already has a pack with that stem. */
export interface PackMoveRequest {
  folder: string;
}

/** POST /api/packs/:id/rename — the new title; the file is renamed to
 *  `<its date>-<slug of title>` too. 409 when that name is taken. */
export interface PackRenameRequest {
  title: string;
}

/** POST /api/folders — a kebab-case name; 409 when it exists. */
export interface FolderRequest {
  name: string;
}

export interface FolderReply extends Committed {
  folder: string;
  folders: string[];
}

/** DELETE /api/folders/:name — only an empty folder; 409 otherwise. */
export interface FolderDeleteReply extends Committed {
  ok: true;
  folders: string[];
}

/* ------------------------------- assembly -------------------------------- */

export interface AssembleRequest {
  pack: Partial<PackInput>;
}

export interface Stats {
  words: number;
  /** words × 1.3, rounded — an estimate for a voice tool's context limit. */
  tokens: number;
  chars: number;
}

/** POST /api/assemble */
export interface AssembleResult {
  markdown: string;
  /** Human-readable sentences: cardinality, missing required slot, unknown
   *  unit/scenario/placeholder. Never fatal — the markdown is always there. */
  warnings: string[];
  stats: Stats;
}

/** POST /api/export — `id` names exports/<id>.md. */
export interface ExportRequest {
  pack: Partial<PackInput>;
  id: string;
}

export interface ExportResult {
  /** Absolute path of the written file. */
  path: string;
  stats: Stats;
  warnings: string[];
}

/** Every non-2xx reply. */
export interface ErrorReply {
  error: string;
}

/* ---------------------------------- chat --------------------------------- */

/** One line of data/chat.jsonl. `commit` lines record an auto-commit the
 *  server made after an agent turn: text is "<short hash>: <summary>". */
export type ChatRole = "user" | "assistant" | "commit";

export interface ChatMessage {
  role: ChatRole;
  text: string;
  /** ISO timestamp. */
  ts: string;
}

/** GET /api/chat/history */
export interface ChatHistoryReply {
  messages: ChatMessage[];
}

/** POST /api/chat — answered as SSE (see the Chat* event shapes). 409 when a
 *  run is already in progress: one agent at a time, by design. */
export interface ChatRequest {
  message: string;
}

/** SSE `start`: the run began, with the model it went out on. */
export interface ChatStart {
  model: string;
}

/** SSE `heartbeat`, every few seconds while the agent works. */
export interface ChatHeartbeat {
  elapsed: number;
}

/** SSE `message`: the agent's final reply (the CLI buffers the whole turn, so
 *  there is nothing to stream before it). `denied` counts tool calls the
 *  sandbox refused — a Write outside content/, say. */
export interface ChatReply extends ChatMessage {
  role: "assistant";
  costUsd: number | null;
  numTurns: number | null;
  denied: number;
}

/** SSE `commit`, after the reply: what the server did with content/. */
export type ChatCommit =
  | { hash: string; summary: string }
  | { skipped: true }
  | { error: string };

/** SSE `error` (the run failed; `error` is a sentence with a hint when the
 *  cause is known: sign-in, usage limit) and `done` (always last). */
export interface ChatError {
  error: string;
}
export interface ChatDone {
  ok: boolean;
}

/* -------------------------------- settings ------------------------------- */

export interface AgentModel {
  /** What the CLI's --model accepts, e.g. "claude-sonnet-5-5". */
  id: string;
  label: string;
  note: string;
}

/** GET/PUT /api/settings — `models` is the list the UI may pick from; PUT
 *  takes {model} and answers with the same shape. */
export interface SettingsReply {
  model: string;
  models: AgentModel[];
}

export interface SettingsRequest {
  model: string;
}
