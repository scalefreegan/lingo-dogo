// The content loader: reads content/ from disk and validates it against
// docs/CONTENT.md, the contract shared with the assembler, the UI and the
// embedded agent. Pure ESM with no server imports, so `node --test` drives it
// directly and the Vite middleware imports it as-is.
//
// The loader never throws on a bad file. The agent edits these files while the
// app is running, and one half-written unit must not take the whole library
// down: each problem is reported with its file path and the rest still loads.
// A file with an `error` (unparseable YAML, a missing required key) is left
// out of the result, so everything the loader does return honours the
// contract's shape; a `warning` (a unit whose slot is not in the schema)
// leaves the file in.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

// Paths derive from import.meta.url, never process.cwd(): `npm run dev` runs
// Vite with cwd web/, the CLI and the tests run from the repo root.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The content root: LINGO_CONTENT_DIR when set (resolved against the repo
 *  root, so a relative path means the same thing from web/ and from the CLI),
 *  else <repo>/content. Read per call rather than at module load, so a test
 *  can point it somewhere else without re-importing. */
export function contentRoot() {
  const override = process.env.LINGO_CONTENT_DIR;
  return override ? path.resolve(REPO_ROOT, override) : path.join(REPO_ROOT, "content");
}

/** Rendered prompts land here (gitignored): LINGO_EXPORTS_DIR when set (so
 *  the tests never write into the real exports/), else <repo>/exports. */
export function exportsDir() {
  const override = process.env.LINGO_EXPORTS_DIR;
  return override ? path.resolve(REPO_ROOT, override) : path.join(REPO_ROOT, "exports");
}

/** Pack and export ids: the filename stem, kebab-case, no dots or slashes —
 *  the one check that keeps a request-supplied id inside its directory. */
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const PICKS = ["one", "any"];

/** The placeholders units and frame.md may use (docs/CONTENT.md). Anything
 *  else in {{ }} is left as-is and reported by the assembler. */
export const PLACEHOLDERS = [
  "learner_name",
  "native_language",
  "target_language",
  "target_variant",
  "level",
  "scenario_title",
];

/* ------------------------------ frontmatter ------------------------------ */

/**
 * Split a markdown file into its YAML frontmatter and body. The frontmatter is
 * the lines between a first line of `---` and the next line of `---`; the
 * contract asks for this split rather than gray-matter so `yaml` stays the one
 * dependency. Returns `{ data, body }` or `{ error }` — never throws.
 */
export function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trimEnd() !== "---") return { error: "missing frontmatter (the file must start with a --- line)" };
  const close = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (close === -1) return { error: "frontmatter is not closed (no second --- line)" };
  let data;
  try {
    data = YAML.parse(lines.slice(1, close).join("\n"));
  } catch (e) {
    return { error: `frontmatter is not valid YAML: ${firstLine(e)}` };
  }
  if (data == null) data = {};
  if (typeof data !== "object" || Array.isArray(data)) return { error: "frontmatter must be a YAML mapping" };
  return { data, body: cleanBody(lines.slice(close + 1).join("\n")) };
}

/** Leading blank lines (the gap after the closing ---) and trailing whitespace
 *  go; everything else is the author's, verbatim. */
function cleanBody(s) {
  return s.replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

function firstLine(e) {
  return String(e?.message ?? e).split("\n")[0];
}

/* -------------------------------- loading -------------------------------- */

/** Repo-relative when the file is inside the repo (what a person or the agent
 *  would type), absolute otherwise (a test fixture in a temp dir). */
function displayPath(abs) {
  const rel = path.relative(REPO_ROOT, abs);
  return rel.startsWith("..") || path.isAbsolute(rel) ? abs : rel;
}

function readText(abs) {
  try {
    return { text: fs.readFileSync(abs, "utf8") };
  } catch (e) {
    return { error: e?.code === "ENOENT" ? "file is missing" : `cannot read: ${firstLine(e)}` };
  }
}

/** Sorted so the library order — and so the UI and any export — never depends
 *  on the filesystem's directory order. A missing directory is an empty one. */
function listDir(abs, ext) {
  let names;
  try {
    names = fs.readdirSync(abs);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(ext) && !n.startsWith(".")).sort();
}

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

/** A list of strings from a YAML value: an array of scalars, a lone scalar,
 *  or nothing. `level: B1` and `level: [B1]` mean the same thing. */
function strList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((x) => x != null && typeof x !== "object").map(String);
}

/**
 * Load and validate everything under the content root.
 * Returns `{ root, schema, frame, profile, units, scenarios, packs, problems }`;
 * `problems` is `[{ file, level: "error"|"warning", message }]`.
 */
export function loadContent(root = contentRoot()) {
  const problems = [];
  const report = (abs, level, message) => problems.push({ file: displayPath(abs), level, message });

  const schema = loadSchema(path.join(root, "schema.yaml"), report);
  const slotIds = new Set(schema.slots.map((s) => s.id));

  const framePath = path.join(root, "frame.md");
  const frameRead = readText(framePath);
  if (frameRead.error) report(framePath, "error", frameRead.error);
  const frame = frameRead.text ? cleanBody(frameRead.text.replace(/\r\n?/g, "\n")) : "";

  const profile = loadProfile(path.join(root, "profile.yaml"), report);

  const units = [];
  const unitsDir = path.join(root, "units");
  for (const name of listDir(unitsDir, ".md")) {
    const unit = loadUnit(path.join(unitsDir, name), report);
    if (!unit) continue;
    if (!slotIds.has(unit.slot)) {
      report(unit.path, "warning", `slot "${unit.slot}" is not in schema.yaml; the unit is shown as unslotted and never assembled`);
    }
    units.push(unit);
  }

  const scenarios = [];
  const scenariosDir = path.join(root, "scenarios");
  for (const name of listDir(scenariosDir, ".md")) {
    const scenario = loadScenario(path.join(scenariosDir, name), report);
    if (scenario) scenarios.push(scenario);
  }

  const packs = [];
  const packsDir = path.join(root, "packs");
  for (const name of listDir(packsDir, ".yaml")) {
    const { pack, problems: packProblems } = loadPackFile(path.join(packsDir, name));
    problems.push(...packProblems);
    if (pack) packs.push(pack);
  }

  return { root, schema, frame, profile, units, scenarios, packs, problems };
}

function loadYamlFile(abs, report) {
  const read = readText(abs);
  if (read.error) {
    report(abs, "error", read.error);
    return undefined;
  }
  try {
    return YAML.parse(read.text);
  } catch (e) {
    report(abs, "error", `not valid YAML: ${firstLine(e)}`);
    return undefined;
  }
}

function loadSchema(abs, report) {
  const raw = loadYamlFile(abs, report);
  const schema = { version: 1, slots: [] };
  if (raw === undefined) return schema;
  if (!isObj(raw)) {
    report(abs, "error", "schema.yaml must be a YAML mapping with a `slots` list");
    return schema;
  }
  Object.assign(schema, raw, { slots: [] });
  if (!Array.isArray(raw.slots)) {
    report(abs, "error", "missing required key `slots` (a list)");
    return schema;
  }
  const seen = new Set();
  raw.slots.forEach((s, i) => {
    const where = `slots[${i}]`;
    if (!isObj(s)) return report(abs, "error", `${where} must be a mapping`);
    const missing = ["id", "title", "pick"].filter((k) => !isStr(s[k]));
    if (missing.length) return report(abs, "error", `${where} is missing required key(s): ${missing.join(", ")}`);
    if (!PICKS.includes(s.pick)) return report(abs, "error", `${where} (${s.id}): pick must be "one" or "any", not "${s.pick}"`);
    if (seen.has(s.id)) return report(abs, "error", `${where}: duplicate slot id "${s.id}"`);
    seen.add(s.id);
    schema.slots.push({
      ...s,
      id: s.id,
      title: s.title,
      pick: s.pick,
      required: s.required === true,
      description: typeof s.description === "string" ? s.description.trim() : "",
    });
  });
  return schema;
}

function loadProfile(abs, report) {
  const raw = loadYamlFile(abs, report);
  if (raw === undefined) return {};
  if (!isObj(raw)) {
    report(abs, "error", "profile.yaml must be a YAML mapping");
    return {};
  }
  return raw;
}

/** Shared by units and scenarios: read, split, check required keys and that
 *  `id` matches the filename (packs refer to units by id, so a mismatch would
 *  leave the file unreachable under the name a person sees on disk). */
function loadMarkdownEntry(abs, required, report) {
  const read = readText(abs);
  if (read.error) return void report(abs, "error", read.error);
  const parsed = parseFrontmatter(read.text);
  if (parsed.error) return void report(abs, "error", parsed.error);
  const fm = parsed.data;
  const missing = required.filter((k) => !isStr(fm[k]));
  if (missing.length) return void report(abs, "error", `missing required key(s): ${missing.join(", ")}`);
  const stem = path.basename(abs, ".md");
  if (fm.id !== stem) return void report(abs, "error", `id "${fm.id}" must equal the filename stem "${stem}"`);
  return { fm, body: parsed.body };
}

function loadUnit(abs, report) {
  const entry = loadMarkdownEntry(abs, ["id", "slot", "title", "summary"], report);
  if (!entry) return null;
  const { fm, body } = entry;
  // Unknown keys are preserved (the spread) and ignored — the contract lets
  // the agent add metadata without a loader change.
  return {
    ...fm,
    id: fm.id,
    slot: fm.slot,
    title: fm.title.trim(),
    summary: fm.summary.trim(),
    tags: strList(fm.tags),
    default: fm.default === true,
    level: strList(fm.level),
    body,
    path: displayPath(abs),
  };
}

function loadScenario(abs, report) {
  const entry = loadMarkdownEntry(abs, ["id", "title", "summary"], report);
  if (!entry) return null;
  const { fm, body } = entry;
  const roles = {};
  if (isObj(fm.roles)) {
    for (const [k, v] of Object.entries(fm.roles)) if (isStr(v)) roles[k] = v.trim();
  } else if (fm.roles != null) {
    report(abs, "warning", "roles should be a mapping (role: description); ignored");
  }
  const vocab = [];
  if (Array.isArray(fm.vocab)) {
    fm.vocab.forEach((v, i) => {
      if (isObj(v) && isStr(v.term)) vocab.push({ term: String(v.term), gloss: v.gloss == null ? "" : String(v.gloss) });
      else report(abs, "warning", `vocab[${i}] needs a term (and usually a gloss); skipped`);
    });
  } else if (fm.vocab != null) {
    report(abs, "warning", "vocab should be a list of { term, gloss }; ignored");
  }
  return {
    ...fm,
    id: fm.id,
    title: fm.title.trim(),
    summary: fm.summary.trim(),
    tags: strList(fm.tags),
    language: typeof fm.language === "string" ? fm.language : null,
    roles,
    beats: strList(fm.beats),
    vocab,
    body,
    path: displayPath(abs),
  };
}

/**
 * Read one pack file (used by the loader for content/packs and by the CLI for
 * whatever path it is given). The pack's id is the filename stem. Returns
 * `{ pack, problems }`, with `pack` null when the file is unusable.
 * Unknown unit or scenario ids are not checked here: that is the assembler's
 * warning, since it depends on the library, not on the file.
 */
export function loadPackFile(abs) {
  const problems = [];
  const report = (level, message) => problems.push({ file: displayPath(abs), level, message });
  const raw = loadYamlFile(abs, (_f, level, message) => report(level, message));
  if (raw === undefined) return { pack: null, problems };
  if (!isObj(raw)) {
    report("error", "a pack must be a YAML mapping");
    return { pack: null, problems };
  }
  if (!isStr(raw.title)) {
    report("error", "missing required key(s): title");
    return { pack: null, problems };
  }
  const stem = path.basename(abs).replace(/\.ya?ml$/, "");
  if (!ID_RE.test(stem)) report("warning", `filename "${stem}" is not a valid pack id (lowercase letters, digits, hyphens); the app cannot save over it`);
  if (raw.units != null && !Array.isArray(raw.units)) report("warning", "units should be a list of unit ids; ignored");
  if (raw.overrides != null && !isObj(raw.overrides)) report("warning", "overrides should be a mapping of profile keys; ignored");
  return { pack: normalizePack(raw, stem), problems };
}

/**
 * Coerce a pack-shaped value (a parsed file, or a JSON body from the UI) into
 * the shape the assembler reads. Lenient by design: a missing field is its
 * empty value, never an error; the assembler warns about what it can't use.
 */
export function normalizePack(raw, id) {
  const p = isObj(raw) ? raw : {};
  const pack = {
    ...p,
    title: typeof p.title === "string" ? p.title : "",
    created: p.created == null ? "" : p.created instanceof Date ? p.created.toISOString() : String(p.created),
    scenario: typeof p.scenario === "string" ? p.scenario : "",
    quick_scenario: typeof p.quick_scenario === "string" ? p.quick_scenario : "",
    units: Array.isArray(p.units) ? p.units.filter((u) => typeof u === "string") : [],
    overrides: isObj(p.overrides) ? p.overrides : {},
    notes: typeof p.notes === "string" ? p.notes : "",
  };
  if (id !== undefined) pack.id = id;
  return pack;
}

/* ------------------------------ pack files ------------------------------- */

/** Resolve `<dir>/<id><ext>` and prove it stays inside `dir`. The id regex
 *  already rules out `/` and `..`; this is the second lock, so a future
 *  loosening of ID_RE cannot turn into a write outside the directory. */
export function safeJoin(dir, id, ext) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`invalid id: ${JSON.stringify(id)}`);
  const base = path.resolve(dir);
  const abs = path.resolve(base, `${id}${ext}`);
  if (path.dirname(abs) !== base) throw new Error(`path escapes ${base}: ${abs}`);
  return abs;
}

export function packsDir(root = contentRoot()) {
  return path.join(root, "packs");
}

/** The keys a pack file carries, in the contract's order; anything else the
 *  caller sent rides along after them (unknown keys are preserved). */
const PACK_KEYS = ["title", "created", "scenario", "quick_scenario", "units", "overrides", "notes"];

/** Write content/packs/<id>.yaml. Returns the absolute path. */
export function savePack(id, raw, root = contentRoot()) {
  const abs = safeJoin(packsDir(root), id, ".yaml");
  const pack = normalizePack(raw);
  delete pack.id; // the filename is the id; storing it too invites the two to disagree
  const ordered = {};
  for (const k of PACK_KEYS) ordered[k] = pack[k];
  for (const [k, v] of Object.entries(pack)) if (!(k in ordered)) ordered[k] = v;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, YAML.stringify(ordered));
  return abs;
}

/** Delete content/packs/<id>.yaml. Returns false when there was no such pack. */
export function deletePack(id, root = contentRoot()) {
  const abs = safeJoin(packsDir(root), id, ".yaml");
  try {
    fs.unlinkSync(abs);
    return true;
  } catch (e) {
    if (e?.code === "ENOENT") return false;
    throw e;
  }
}

/** Write exports/<id>.md (mkdir -p). Returns the absolute path. */
export function writeExport(id, markdown, dir = exportsDir()) {
  const abs = safeJoin(dir, id, ".md");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, markdown);
  return abs;
}
