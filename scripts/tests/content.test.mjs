// The loader against docs/CONTENT.md: what loads, what is reported, and that
// a bad file is reported rather than thrown.
//   node --test scripts/tests/content.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  loadContent, loadPackFile, parseFrontmatter, savePack, deletePack, saveProfile, writeExport, safeJoin, contentRoot,
} from "../content.mjs";
import { FIXTURE, copyFixture, write } from "./helpers.mjs";

const problemFor = (content, suffix) => content.problems.filter((p) => p.file.endsWith(suffix));

test("loads the fixture tree: schema order, units, scenarios, packs, profile, frame", () => {
  const c = loadContent(FIXTURE);
  assert.deepEqual(c.schema.slots.map((s) => s.id), ["intro", "warmup", "corrections", "debrief"]);
  assert.equal(c.schema.slots[0].required, true);
  assert.equal(c.schema.slots[1].required, false);
  // sorted by filename, broken-unit.md left out
  assert.deepEqual(c.units.map((u) => u.id), [
    "correct-gently", "correct-strict", "debrief-top-three", "intro-native", "intro-target",
    "orphan-unit", "warmup-odd", "warmup-vocab",
  ]);
  assert.deepEqual(c.scenarios.map((s) => s.id), ["market", "plaza"]);
  assert.deepEqual(c.packs.map((p) => p.id), ["2026-10-19-market-gentle"]);
  assert.equal(c.profile.learner_name, "Sam");
  assert.match(c.frame, /^You are the dojo master/);
  // languages.yaml: file order, variants [] when the key is absent
  assert.deepEqual(c.languages.map((l) => l.name), ["English", "Spanish", "Japanese", "Italian", "Korean"]);
  assert.deepEqual(c.languages[2].variants, ["Standard Japanese (Tokyo)", "Kansai dialect"]);
  assert.deepEqual(c.languages[4], { name: "Korean", variants: [] });
});

test("languages.yaml: missing is a warning and an empty list; off-contract is an error; bad entries are skipped", () => {
  const root = copyFixture();
  const file = path.join(root, "languages.yaml");
  fs.rmSync(file);
  let c = loadContent(root);
  assert.deepEqual(c.languages, []);
  assert.deepEqual(problemFor(c, "languages.yaml").map((p) => p.level), ["warning"]);
  assert.match(problemFor(c, "languages.yaml")[0].message, /file is missing; the language pickers fall back to free text/);

  write(root, "languages.yaml", "languages: {name: nope}\n");
  c = loadContent(root);
  assert.deepEqual(c.languages, []);
  assert.match(problemFor(c, "languages.yaml").map((p) => `${p.level}: ${p.message}`).join(), /^error: languages\.yaml must be a YAML mapping with a `languages` list$/);

  write(root, "languages.yaml", "languages: [unclosed\n");
  c = loadContent(root);
  assert.deepEqual(c.languages, []);
  assert.match(problemFor(c, "languages.yaml")[0].message, /^not valid YAML/);

  write(root, "languages.yaml", [
    "languages:",
    "  - name: Ok",
    "    variants: [A, 3]",
    "  - variants: [X]",
    "  - name: Bad",
    "    variants: Nope",
    "  - name: Ok",
    "  - name: '  '",
  ].join("\n"));
  c = loadContent(root);
  assert.deepEqual(c.languages, [{ name: "Ok", variants: ["A"] }]);
  assert.deepEqual(problemFor(c, "languages.yaml").map((p) => `${p.level}: ${p.message}`), [
    "warning: languages[0] (Ok): variants[1] is not a string; skipped",
    "error: languages[1] needs a non-empty `name`; skipped",
    "error: languages[2] (Bad): `variants` must be a list of strings; skipped",
    'warning: languages[3]: duplicate language "Ok"; kept the first',
    "error: languages[4] needs a non-empty `name`; skipped",
  ]);
});

test("unit fields are normalized; unknown frontmatter keys are preserved", () => {
  const c = loadContent(FIXTURE);
  const vocab = c.units.find((u) => u.id === "warmup-vocab");
  assert.equal(vocab.default, true);
  assert.deepEqual(vocab.tags, ["warmup", "vocab"]);
  assert.equal(vocab.source, "fixture");
  const target = c.units.find((u) => u.id === "intro-target");
  assert.equal(target.default, false, "default is optional and false when absent");
  assert.deepEqual(target.level, ["B1"], "a scalar level becomes a one-item list");
  const native = c.units.find((u) => u.id === "intro-native");
  assert.ok(native.body.startsWith("Greet {{learner_name}}"), "leading blank lines after --- are dropped");
  const gently = c.units.find((u) => u.id === "correct-gently");
  assert.ok(gently.body.endsWith("continue."), "trailing whitespace is trimmed");
});

test("scenario fields: roles, beats, vocab; only id/title/summary required", () => {
  const c = loadContent(FIXTURE);
  const market = c.scenarios.find((s) => s.id === "market");
  assert.equal(market.roles.dojo_master, "Doña Rosa, the fruit vendor, quick and friendly");
  assert.equal(market.beats.length, 3);
  assert.deepEqual(market.vocab[0], { term: "¿Cuánto cuesta?", gloss: "How much is it?" });
  assert.equal(market.language, "es-MX");
  const plaza = c.scenarios.find((s) => s.id === "plaza");
  assert.deepEqual([plaza.roles, plaza.beats, plaza.vocab, plaza.body], [{}, [], [], ""]);
});

test("a unit missing a required key is an error with its file path, and is not loaded", () => {
  const c = loadContent(FIXTURE);
  const [p, ...rest] = problemFor(c, "units/broken-unit.md");
  assert.equal(rest.length, 0);
  assert.equal(p.level, "error");
  assert.match(p.message, /missing required key\(s\): title/);
  assert.ok(!c.units.some((u) => u.id === "broken-unit"));
});

test("a unit whose slot is not in the schema loads with a warning", () => {
  const c = loadContent(FIXTURE);
  const [p] = problemFor(c, "units/orphan-unit.md");
  assert.equal(p.level, "warning");
  assert.match(p.message, /slot "interrupts" is not in schema\.yaml/);
  assert.ok(c.units.some((u) => u.id === "orphan-unit"));
});

test("the fixture has exactly the two deliberate problems", () => {
  // Pins the fixture itself: a new problem here means a test's premise moved.
  const c = loadContent(FIXTURE);
  assert.deepEqual(c.problems.map((p) => [path.basename(p.file), p.level]), [
    ["broken-unit.md", "error"],
    ["orphan-unit.md", "warning"],
  ]);
});

test("bad files are reported, never thrown: bad YAML, no frontmatter, id/filename mismatch, missing scenario keys", () => {
  const root = copyFixture();
  write(root, "units/bad-yaml.md", "---\nid: bad-yaml\nslot: [unclosed\n---\nbody\n");
  write(root, "units/no-fm.md", "Just a body, no frontmatter.\n");
  write(root, "units/unclosed.md", "---\nid: unclosed\nslot: warmup\n");
  write(root, "units/renamed.md", "---\nid: something-else\nslot: warmup\ntitle: T\nsummary: S\n---\nbody\n");
  write(root, "scenarios/no-summary.md", "---\nid: no-summary\ntitle: T\n---\n");
  write(root, "packs/2026-01-01-bad.yaml", "title: [unclosed\n");
  write(root, "packs/2026-01-02-untitled.yaml", "units: [intro-native]\n");
  let c;
  assert.doesNotThrow(() => { c = loadContent(root); });
  const msg = (suffix) => problemFor(c, suffix).map((p) => `${p.level}: ${p.message}`).join(" | ");
  assert.match(msg("units/bad-yaml.md"), /^error: frontmatter is not valid YAML/);
  assert.match(msg("units/no-fm.md"), /^error: missing frontmatter/);
  assert.match(msg("units/unclosed.md"), /^error: frontmatter is not closed/);
  assert.match(msg("units/renamed.md"), /^error: id "something-else" must equal the filename stem "renamed"/);
  assert.match(msg("scenarios/no-summary.md"), /^error: missing required key\(s\): summary/);
  assert.match(msg("packs/2026-01-01-bad.yaml"), /^error: not valid YAML/);
  assert.match(msg("packs/2026-01-02-untitled.yaml"), /^error: missing required key\(s\): title/);
  // every rejected file is absent; the good ones still load
  for (const id of ["bad-yaml", "no-fm", "unclosed", "renamed"]) assert.ok(!c.units.some((u) => u.id === id), id);
  assert.ok(c.units.some((u) => u.id === "intro-native"));
  assert.deepEqual(c.packs.map((p) => p.id), ["2026-10-19-market-gentle"]);
});

test("missing files and a bad schema are problems, not crashes", () => {
  const root = copyFixture();
  fs.rmSync(path.join(root, "frame.md"));
  fs.rmSync(path.join(root, "profile.yaml"));
  write(root, "schema.yaml", [
    "version: 1",
    "slots:",
    "  - { id: intro, title: Introduction, pick: one, required: true }",
    "  - { id: warmup, title: Warm-up, pick: some }",
    "  - { id: intro, title: Again, pick: any }",
    "  - { title: No id, pick: any }",
  ].join("\n"));
  const c = loadContent(root);
  assert.equal(c.frame, "");
  assert.deepEqual(c.profile, {});
  assert.deepEqual(c.schema.slots.map((s) => s.id), ["intro"]);
  const messages = c.problems.map((p) => `${path.basename(p.file)}: ${p.message}`);
  assert.ok(messages.includes("frame.md: file is missing"), messages.join("\n"));
  assert.ok(messages.includes("profile.yaml: file is missing"));
  assert.ok(messages.some((m) => /schema\.yaml: slots\[1\] \(warmup\): pick must be "one" or "any"/.test(m)));
  assert.ok(messages.some((m) => /schema\.yaml: slots\[2\]: duplicate slot id "intro"/.test(m)));
  assert.ok(messages.some((m) => /schema\.yaml: slots\[3\] is missing required key\(s\): id/.test(m)));
});

test("an empty content root loads as an empty library with problems", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingo-dojo-empty-"));
  try {
    const c = loadContent(root);
    assert.deepEqual([c.units, c.scenarios, c.packs, c.schema.slots, c.languages], [[], [], [], [], []]);
    assert.ok(c.problems.some((p) => p.file.endsWith("schema.yaml") && p.level === "error"));
    assert.ok(c.problems.some((p) => p.file.endsWith("languages.yaml") && p.level === "warning"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("parseFrontmatter tolerates CRLF and an empty frontmatter block", () => {
  assert.deepEqual(parseFrontmatter("---\r\nid: x\r\n---\r\n\r\nbody\r\n"), { data: { id: "x" }, body: "body" });
  assert.deepEqual(parseFrontmatter("---\n---\nbody"), { data: {}, body: "body" });
  assert.ok(parseFrontmatter("---\n- a\n- b\n---\n").error.includes("mapping"));
});

test("LINGO_CONTENT_DIR moves the content root, resolved against the repo root", () => {
  const before = process.env.LINGO_CONTENT_DIR;
  try {
    process.env.LINGO_CONTENT_DIR = "scripts/tests/fixtures/content";
    assert.equal(contentRoot(), FIXTURE);
    assert.equal(loadContent().profile.learner_name, "Sam");
  } finally {
    if (before === undefined) delete process.env.LINGO_CONTENT_DIR;
    else process.env.LINGO_CONTENT_DIR = before;
  }
});

test("savePack writes contract-ordered YAML that loads back; deletePack removes it", () => {
  const root = copyFixture();
  const abs = savePack("2026-10-20-plaza-chat", {
    id: "ignored-in-body",
    notes: "Talk about the weather.\n",
    title: "Plaza chat",
    created: "2026-10-20T10:00:00-06:00",
    scenario: "plaza",
    units: ["intro-target", "warmup-vocab"],
    overrides: { level: "B2" },
    extra: "kept",
  }, root);
  assert.equal(abs, path.join(root, "packs", "2026-10-20-plaza-chat.yaml"));
  const text = fs.readFileSync(abs, "utf8");
  assert.deepEqual(Object.keys(YAML.parse(text)), [
    "title", "created", "scenario", "quick_scenario", "units", "overrides", "notes", "extra",
  ]);
  const { pack, problems } = loadPackFile(abs);
  assert.deepEqual(problems, []);
  assert.equal(pack.id, "2026-10-20-plaza-chat");
  assert.deepEqual(pack.units, ["intro-target", "warmup-vocab"]);
  assert.equal(pack.overrides.level, "B2");
  assert.equal(pack.notes, "Talk about the weather.\n");
  assert.equal(deletePack("2026-10-20-plaza-chat", root), true);
  assert.equal(deletePack("2026-10-20-plaza-chat", root), false);
});

test("saveProfile merges in place: other keys keep their order, comments and block style; blank removes a key", () => {
  const root = copyFixture();
  const abs = path.join(root, "profile.yaml");
  fs.writeFileSync(abs, [
    "# who is practising",
    "learner_name: Sam # not Samantha",
    "native_language: English",
    "target_language: Spanish",
    "target_variant: Mexican Spanish",
    "level: A2",
    "goals: >",
    "  Order food and chat",
    "  with vendors.",
    "notes: Likes direct corrections.",
    "",
  ].join("\n"));
  assert.equal(saveProfile({ target_language: "Japanese", target_variant: "", level: " B1 " }, root), abs);
  const text = fs.readFileSync(abs, "utf8");
  assert.deepEqual(Object.keys(YAML.parse(text)), ["learner_name", "native_language", "target_language", "level", "goals", "notes"]);
  assert.ok(text.startsWith("# who is practising\nlearner_name: Sam # not Samantha\n"), text);
  // yaml keeps the block style and the value but re-flows a folded scalar's
  // line breaks to its line width; that is the "as best yaml allows" caveat.
  assert.match(text, /\ngoals: >\n  Order food/, "the folded block style is kept");
  assert.equal(YAML.parse(text).goals, "Order food and chat with vendors.\n");
  const profile = loadContent(root).profile;
  assert.equal(profile.target_language, "Japanese");
  assert.equal(profile.level, "B1", "values are trimmed");
  assert.ok(!("target_variant" in profile), "a blank value removes the key rather than writing an empty string");
  // a key the profile never had is appended
  saveProfile({ target_variant: "Kansai dialect" }, root);
  assert.ok(fs.readFileSync(abs, "utf8").endsWith("notes: Likes direct corrections.\ntarget_variant: Kansai dialect\n"));
});

test("saveProfile creates a missing profile.yaml and refuses to overwrite a broken one", () => {
  const root = copyFixture();
  const abs = path.join(root, "profile.yaml");
  fs.rmSync(abs);
  saveProfile({ level: "A1" }, root);
  assert.equal(fs.readFileSync(abs, "utf8"), "level: A1\n");
  for (const broken of ["a: [unclosed\n", "just a scalar\n", "- a list\n"]) {
    fs.writeFileSync(abs, broken);
    assert.throws(() => saveProfile({ level: "A1" }, root), /not valid YAML|must be a YAML mapping/, JSON.stringify(broken));
    assert.equal(fs.readFileSync(abs, "utf8"), broken, "the broken file is left for a person to fix");
  }
});

test("ids that could escape their directory are refused before any write", () => {
  const root = copyFixture();
  for (const id of ["../evil", "a/b", "A-Upper", "-leading", "", "x.yaml", "..", "a\\b"]) {
    assert.throws(() => savePack(id, { title: "t" }, root), /invalid id/, id);
    assert.throws(() => writeExport(id, "x", path.join(root, "exports")), /invalid id/, id);
  }
  assert.throws(() => safeJoin(root, "ok", "/../../x"), /escapes/);
  assert.ok(!fs.existsSync(path.join(root, "evil.yaml")));
});
