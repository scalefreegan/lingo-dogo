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
  loadContent, loadPackFile, parseFrontmatter, savePack, deletePack, writeExport, safeJoin, contentRoot,
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
    assert.deepEqual([c.units, c.scenarios, c.packs, c.schema.slots], [[], [], [], []]);
    assert.ok(c.problems.some((p) => p.file.endsWith("schema.yaml") && p.level === "error"));
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

test("ids that could escape their directory are refused before any write", () => {
  const root = copyFixture();
  for (const id of ["../evil", "a/b", "A-Upper", "-leading", "", "x.yaml", "..", "a\\b"]) {
    assert.throws(() => savePack(id, { title: "t" }, root), /invalid id/, id);
    assert.throws(() => writeExport(id, "x", path.join(root, "exports")), /invalid id/, id);
  }
  assert.throws(() => safeJoin(root, "ok", "/../../x"), /escapes/);
  assert.ok(!fs.existsSync(path.join(root, "evil.yaml")));
});
