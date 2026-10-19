// The API routes end to end: the real Vite plugin (web/server/api.ts, loaded
// through Node's TypeScript type stripping) mounted on a tiny connect-style
// stack behind a real node:http server, driven with fetch on an ephemeral
// port. LINGO_CONTENT_DIR points the routes at a temp copy of the fixture
// library and LINGO_EXPORTS_DIR at a temp exports/, so nothing here touches
// the real content/ or exports/.
//   node --test scripts/tests/api.http.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveApi } from "./connect-stack.mjs";
import { copyFixture } from "./helpers.mjs";

const root = copyFixture();
const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lingo-dojo-exports-"));
process.env.LINGO_CONTENT_DIR = root;
process.env.LINGO_EXPORTS_DIR = exportsDir;

const { apiPlugins, sameOrigin } = await import("../../web/server/api.ts");

let base, close;
before(async () => ({ base, close } = await serveApi(apiPlugins)));
after(() => close());

const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const pack = {
  title: "Plaza chat",
  created: "2026-10-20T10:00:00-06:00",
  scenario: "plaza",
  quick_scenario: "",
  units: ["intro-target", "warmup-vocab"],
  overrides: { level: "B2" },
  notes: "",
};

test("sameOrigin: no Origin passes, a matching host passes, anything else is refused", () => {
  assert.equal(sameOrigin(undefined, "localhost:38400"), true);
  assert.equal(sameOrigin("http://localhost:38400", "localhost:38400"), true);
  assert.equal(sameOrigin("https://evil.example", "localhost:38400"), false);
  assert.equal(sameOrigin("not a url", "localhost:38400"), false);
  assert.equal(sameOrigin("http://localhost:38400", undefined), false);
});

test("a cross-origin request is refused on every route", async () => {
  const profileBefore = fs.readFileSync(path.join(root, "profile.yaml"), "utf8");
  for (const [m, u] of [["GET", "/api/content"], ["POST", "/api/assemble"], ["PUT", "/api/packs/2026-10-20-x"], ["POST", "/api/export"], ["PUT", "/api/profile"]]) {
    const r = await call(m, u, m === "GET" ? undefined : { pack, id: "x", level: "C2" }, { Origin: "https://evil.example" });
    assert.equal(r.status, 403, `${m} ${u}`);
  }
  assert.ok(!fs.existsSync(path.join(root, "packs", "2026-10-20-x.yaml")));
  assert.equal(fs.readFileSync(path.join(root, "profile.yaml"), "utf8"), profileBefore);
});

test("GET /api/content: the library without packs, problems included", async () => {
  const { status, body } = await call("GET", "/api/content");
  assert.equal(status, 200);
  assert.deepEqual(body.schema.slots.map((s) => s.id), ["intro", "warmup", "corrections", "debrief"]);
  assert.ok(body.units.some((u) => u.id === "intro-native"));
  assert.deepEqual(body.languages.map((l) => l.name), ["English", "Spanish", "Japanese", "Italian", "Korean"]);
  assert.equal(body.packs, undefined);
  assert.equal(body.problems.length, 2);
});

test("PUT /api/profile merges the picker keys into profile.yaml, keeps the rest, and validates the body", async () => {
  const file = path.join(root, "profile.yaml");
  const before = fs.readFileSync(file, "utf8");
  try {
    const r = await call("PUT", "/api/profile", { target_language: "Japanese", target_variant: "Kansai dialect", level: "B1" });
    assert.equal(r.status, 200);
    assert.equal(r.body.profile.target_language, "Japanese");
    assert.equal(r.body.profile.learner_name, "Sam", "keys the body doesn't name are kept");
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.startsWith("learner_name: Sam\nnative_language: English\ntarget_language: Japanese\ntarget_variant: Kansai dialect\nlevel: B1\ngoals: "), text);
    assert.equal((await call("GET", "/api/content")).body.profile.level, "B1", "the next content read sees it");

    // a blank value removes the key
    const cleared = await call("PUT", "/api/profile", { target_variant: "" });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.profile.target_variant, undefined);
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /target_variant/);

    // rejected bodies: unknown key, non-string, too long, not an object, empty, not JSON
    const after = fs.readFileSync(file, "utf8");
    for (const bad of [{ learner_name: "Eve" }, { level: 42 }, { level: "x".repeat(81) }, { level: "B1", goals: "" }, [], {}, "{not json"]) {
      const r = await call("PUT", "/api/profile", bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match(r.body.error, /./);
    }
    assert.equal(fs.readFileSync(file, "utf8"), after, "a rejected body writes nothing");
    assert.equal((await call("GET", "/api/profile")).status, 405);
    assert.equal((await call("PUT", "/api/profile/extra", { level: "A1" })).status, 404);
    assert.equal(fs.readFileSync(file, "utf8"), after);
  } finally {
    fs.writeFileSync(file, before); // the later tests assemble against the fixture profile
  }
});

test("GET /api/content re-reads disk on every call", async () => {
  fs.writeFileSync(path.join(root, "scenarios", "beach.md"), "---\nid: beach\ntitle: Beach\nsummary: Sand.\n---\n");
  try {
    const { body } = await call("GET", "/api/content");
    assert.ok(body.scenarios.some((s) => s.id === "beach"));
  } finally {
    fs.rmSync(path.join(root, "scenarios", "beach.md"));
  }
});

test("packs: PUT writes YAML, GET lists and reads it, DELETE removes it", async () => {
  const id = "2026-10-20-plaza-chat";
  const put = await call("PUT", `/api/packs/${id}`, { ...pack, id: "ignored" });
  assert.equal(put.status, 200);
  assert.equal(put.body.pack.id, id);
  assert.deepEqual(put.body.pack.units, pack.units);
  assert.match(fs.readFileSync(path.join(root, "packs", `${id}.yaml`), "utf8"), /^title: Plaza chat\n/);

  const list = await call("GET", "/api/packs");
  assert.deepEqual(list.body.packs.map((p) => p.id), ["2026-10-19-market-gentle", id]);
  assert.equal((await call("GET", `/api/packs/${id}`)).body.pack.overrides.level, "B2");

  assert.equal((await call("DELETE", `/api/packs/${id}`)).status, 200);
  assert.equal((await call("DELETE", `/api/packs/${id}`)).status, 404);
  assert.equal((await call("GET", `/api/packs/${id}`)).status, 404);
});

test("pack ids are validated: traversal, case and junk are 400 and nothing is written", async () => {
  const before = fs.readdirSync(path.join(root, "packs")).sort();
  for (const id of ["..%2Fevil", "Upper-Case", "-x", "a.b", "a%2Fb", "%ZZ"]) {
    const r = await call("PUT", `/api/packs/${id}`, pack);
    assert.equal(r.status, 400, id);
  }
  // fetch folds an encoded dot-segment before sending (/api/packs/%2E%2E is
  // /api/), so this one never reaches handlePacks: the catch-all 404s it.
  assert.equal((await call("PUT", "/api/packs/%2E%2E", pack)).status, 404);
  assert.equal((await call("PUT", "/api/packs/2026-10-20-x", { ...pack, title: "  " })).status, 400);
  assert.equal((await call("PUT", "/api/packs/2026-10-20-x", "[1,2]")).status, 400);
  assert.equal((await call("PUT", "/api/packs/2026-10-20-x", "{not json")).status, 400);
  assert.deepEqual(fs.readdirSync(path.join(root, "packs")).sort(), before);
  assert.equal(fs.readdirSync(path.dirname(root)).length, 1, "nothing written beside content/");
});

test("POST /api/assemble returns markdown, warnings and stats", async () => {
  const r = await call("POST", "/api/assemble", { pack: { ...pack, units: ["warmup-vocab"] } });
  assert.equal(r.status, 200);
  assert.match(r.body.markdown, /^# Lingo Dojo session: Evening in the plaza\n/);
  assert.deepEqual(r.body.warnings, ['Required slot "Introduction" has no unit selected.']);
  assert.ok(r.body.stats.words > 0);
  assert.equal((await call("POST", "/api/assemble", {})).status, 400);
  assert.equal((await call("GET", "/api/assemble")).status, 405);
});

test("POST /api/export writes exports/<id>.md and refuses a bad id", async () => {
  const r = await call("POST", "/api/export", { pack, id: "2026-10-20-plaza-chat" });
  assert.equal(r.status, 200);
  assert.equal(r.body.path, path.join(exportsDir, "2026-10-20-plaza-chat.md"));
  const assembled = await call("POST", "/api/assemble", { pack });
  assert.equal(fs.readFileSync(r.body.path, "utf8"), assembled.body.markdown);
  assert.deepEqual(r.body.stats, assembled.body.stats);
  for (const id of ["../escape", "", null, "A"]) {
    assert.equal((await call("POST", "/api/export", { pack, id })).status, 400, String(id));
  }
  assert.deepEqual(fs.readdirSync(exportsDir), ["2026-10-20-plaza-chat.md"]);
});

test("an unknown /api route is a JSON 404, not the SPA shell", async () => {
  const r = await call("GET", "/api/nope");
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { error: "no such route" });
});
