// The API routes end to end: the real Vite plugin (web/server/api.ts, loaded
// through Node's TypeScript type stripping) mounted on a tiny connect-style
// stack behind a real node:http server, driven with fetch on an ephemeral
// port. LINGO_CONTENT_DIR points the routes at a temp copy of the fixture
// library and LINGO_EXPORTS_DIR at a temp exports/, so nothing here touches
// the real content/ or exports/. The pack routes commit after every write,
// so the temp dir around the content copy is made a throwaway git repo and
// LINGO_REPO_ROOT points there: the `packs:` commits land in it, never here.
//   node --test scripts/tests/api.http.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serveApi } from "./connect-stack.mjs";
import { copyFixture } from "./helpers.mjs";

const root = copyFixture();
const repo = path.dirname(root);
const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "lingo-dojo-exports-"));
process.env.LINGO_CONTENT_DIR = root;
process.env.LINGO_EXPORTS_DIR = exportsDir;
process.env.LINGO_REPO_ROOT = repo;
// An identity for the throwaway repo, whatever the machine's git config says;
// the server's git calls inherit process.env.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid",
});
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
git("init", "-q");
git("config", "commit.gpgsign", "false");
git("add", "-A");
git("commit", "-q", "-m", "fixture");
/** Commit subjects in the throwaway repo, newest first. */
const subjects = () => git("log", "--format=%s").trim().split("\n");

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
  for (const [m, u] of [
    ["GET", "/api/content"], ["POST", "/api/assemble"], ["PUT", "/api/packs/2026-10-20-x"], ["POST", "/api/export"], ["PUT", "/api/profile"],
    ["POST", "/api/packs/2026-10-19-market-gentle/move"], ["POST", "/api/packs/2026-10-19-market-gentle/rename"],
    ["DELETE", "/api/packs/2026-10-19-market-gentle"], ["POST", "/api/folders"], ["DELETE", "/api/folders/x"],
  ]) {
    const r = await call(m, u, m === "GET" ? undefined : { pack, id: "x", level: "C2", folder: "x", title: "T", name: "x" }, { Origin: "https://evil.example" });
    assert.equal(r.status, 403, `${m} ${u}`);
  }
  assert.ok(!fs.existsSync(path.join(root, "packs", "2026-10-20-x.yaml")));
  assert.deepEqual(fs.readdirSync(path.join(root, "packs")), ["2026-10-19-market-gentle.yaml"]);
  assert.equal(fs.readFileSync(path.join(root, "profile.yaml"), "utf8"), profileBefore);
  assert.deepEqual(subjects(), ["fixture"], "nothing was committed");
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

test("packs: PUT writes YAML and commits, GET lists and reads it, DELETE removes it and commits", async () => {
  const id = "2026-10-20-plaza-chat";
  const put = await call("PUT", `/api/packs/${id}`, { ...pack, id: "ignored" });
  assert.equal(put.status, 200);
  assert.equal(put.body.pack.id, id);
  assert.equal(put.body.pack.folder, "");
  assert.deepEqual(put.body.pack.units, pack.units);
  assert.match(fs.readFileSync(path.join(root, "packs", `${id}.yaml`), "utf8"), /^title: Plaza chat\n/);
  assert.match(put.body.commit.hash, /^[0-9a-f]{7,}$/);
  assert.equal(put.body.commit.summary, `saved ${id}`);
  assert.equal(put.body.error, undefined);
  assert.equal(subjects()[0], `packs: saved ${id}`);
  assert.equal(git("show", "--stat", "--format=", "HEAD").trim().split("\n").length, 2, "one file in the commit");

  // an identical save has nothing to commit: commit null, no error
  const again = await call("PUT", `/api/packs/${id}`, { ...pack });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.commit, null);
  assert.equal(again.body.error, undefined);
  assert.equal(subjects().length, 2);

  const list = await call("GET", "/api/packs");
  assert.deepEqual(list.body.packs.map((p) => p.id), ["2026-10-19-market-gentle", id]);
  assert.deepEqual(list.body.folders, []);
  assert.equal((await call("GET", `/api/packs/${id}`)).body.pack.overrides.level, "B2");

  const del = await call("DELETE", `/api/packs/${id}`);
  assert.equal(del.status, 200);
  assert.equal(del.body.ok, true);
  assert.equal(del.body.commit.summary, `deleted ${id}`);
  assert.equal(subjects()[0], `packs: deleted ${id}`);
  assert.equal((await call("DELETE", `/api/packs/${id}`)).status, 404);
  assert.equal((await call("GET", `/api/packs/${id}`)).status, 404);
  assert.equal(subjects().length, 3, "a 404 commits nothing");
});

test("pack ids are validated: traversal, case, depth and junk are 400 and nothing is written", async () => {
  const before = fs.readdirSync(path.join(root, "packs")).sort();
  const commits = subjects().length;
  for (const id of ["..%2Fevil", "Upper-Case", "-x", "a.b", "a%2Fb%2Fc", "a%2F..%2Fb", "%2Fa", "a%2F", "%ZZ", ".keep%2Fx"]) {
    const r = await call("PUT", `/api/packs/${id}`, pack);
    assert.equal(r.status, 400, id);
    assert.match(r.body.error, /invalid id|malformed id/, id);
  }
  // fetch folds an encoded dot-segment before sending (/api/packs/%2E%2E is
  // /api/), so this one never reaches handlePacks: the catch-all 404s it.
  assert.equal((await call("PUT", "/api/packs/%2E%2E", pack)).status, 404);
  assert.equal((await call("PUT", "/api/packs/2026-10-20-x", { ...pack, title: "  " })).status, 400);
  assert.equal((await call("PUT", "/api/packs/2026-10-20-x", "[1,2]")).status, 400);
  assert.equal((await call("PUT", "/api/packs/2026-10-20-x", "{not json")).status, 400);
  assert.deepEqual(fs.readdirSync(path.join(root, "packs")).sort(), before);
  assert.deepEqual(fs.readdirSync(repo).sort(), [".git", "content"], "nothing written beside content/");
  assert.equal(subjects().length, commits, "nothing committed");
});

test("folders: create, save into, move, rename, delete — each a `packs:` commit of content/packs only", async () => {
  const commits = subjects().length;
  // create
  const made = await call("POST", "/api/folders", { name: "oaxaca" });
  assert.equal(made.status, 200);
  assert.equal(made.body.folder, "oaxaca");
  assert.deepEqual(made.body.folders, ["oaxaca"]);
  assert.equal(made.body.commit.summary, "folder oaxaca created");
  assert.ok(fs.existsSync(path.join(root, "packs", "oaxaca", ".keep")));
  assert.equal((await call("POST", "/api/folders", { name: "oaxaca" })).status, 409);
  for (const bad of [{ name: "Oaxaca" }, { name: "a/b" }, { name: ".." }, { name: "" }, { nope: 1 }, "[]"]) {
    assert.equal((await call("POST", "/api/folders", bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call("GET", "/api/folders")).status, 405);
  assert.deepEqual((await call("GET", "/api/packs")).body.folders, ["oaxaca"]);

  // save into a folder: the id carries it, encoded or not
  const id = "oaxaca/2026-10-20-mezcal";
  const put = await call("PUT", "/api/packs/oaxaca%2F2026-10-20-mezcal", { ...pack, title: "Mezcal" });
  assert.equal(put.status, 200);
  assert.equal(put.body.pack.id, id);
  assert.equal(put.body.pack.folder, "oaxaca");
  assert.equal(put.body.commit.summary, `saved ${id}`);
  assert.equal((await call("GET", `/api/packs/${id}`)).body.pack.title, "Mezcal");
  assert.equal((await call("GET", "/api/packs/oaxaca%2F2026-10-20-mezcal")).body.pack.title, "Mezcal");
  assert.deepEqual((await call("GET", "/api/packs")).body.packs.map((p) => p.id), ["2026-10-19-market-gentle", id]);
  // the folder is in use now
  assert.equal((await call("DELETE", "/api/folders/oaxaca")).status, 409);

  // rename: title and stem change, date and folder stay
  const renamed = await call("POST", `/api/packs/${id}/rename`, { title: "Mezcal, slowly" });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.pack.id, "oaxaca/2026-10-20-mezcal-slowly");
  assert.equal(renamed.body.pack.title, "Mezcal, slowly");
  assert.equal(renamed.body.commit.summary, `renamed ${id} to oaxaca/2026-10-20-mezcal-slowly`);
  assert.ok(!fs.existsSync(path.join(root, "packs", "oaxaca", "2026-10-20-mezcal.yaml")));
  assert.equal((await call("POST", `/api/packs/${id}/rename`, { title: "X" })).status, 404, "the old id is gone");
  assert.equal((await call("POST", "/api/packs/oaxaca%2F2026-10-20-mezcal-slowly/rename", { title: " " })).status, 400);
  assert.equal((await call("POST", "/api/packs/oaxaca%2F2026-10-20-mezcal-slowly/rename", {})).status, 400);

  // move to the top level, and refuse to move over an existing pack
  const moved = await call("POST", "/api/packs/oaxaca/2026-10-20-mezcal-slowly/move", { folder: "" });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.pack.id, "2026-10-20-mezcal-slowly");
  assert.equal(moved.body.pack.folder, "");
  assert.equal(moved.body.commit.summary, "moved oaxaca/2026-10-20-mezcal-slowly to no folder");
  await call("PUT", "/api/packs/oaxaca%2F2026-10-20-mezcal-slowly", { ...pack, title: "Clash" });
  assert.equal((await call("POST", "/api/packs/2026-10-20-mezcal-slowly/move", { folder: "oaxaca" })).status, 409);
  assert.equal((await call("POST", "/api/packs/2026-10-20-mezcal-slowly/move", { folder: "a/b" })).status, 400);
  assert.equal((await call("POST", "/api/packs/2026-10-20-mezcal-slowly/move", {})).status, 400);
  assert.equal((await call("POST", "/api/packs/2026-10-20-nope/move", { folder: "oaxaca" })).status, 404);
  // "…/explode" is not an action, so it is read as the pack id "2026-10-20-mezcal-slowly/explode" — which has no POST
  assert.equal((await call("POST", "/api/packs/2026-10-20-mezcal-slowly/explode", { folder: "oaxaca" })).status, 405);
  assert.equal((await call("POST", "/api/packs/a/b/c/move", { folder: "oaxaca" })).status, 400, "too deep an id");
  assert.equal((await call("DELETE", "/api/packs/oaxaca%2F2026-10-20-mezcal-slowly")).status, 200);
  const back = await call("POST", "/api/packs/2026-10-20-mezcal-slowly/move", { folder: "oaxaca" });
  assert.equal(back.body.pack.id, "oaxaca/2026-10-20-mezcal-slowly");
  assert.equal(back.body.commit.summary, "moved 2026-10-20-mezcal-slowly to oaxaca");

  // delete the pack, then the (now empty) folder
  assert.equal((await call("DELETE", "/api/packs/oaxaca%2F2026-10-20-mezcal-slowly")).status, 200);
  const gone = await call("DELETE", "/api/folders/oaxaca");
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body, { ok: true, folders: [], commit: { hash: gone.body.commit.hash, summary: "folder oaxaca deleted" } });
  assert.equal((await call("DELETE", "/api/folders/oaxaca")).status, 404);
  assert.equal((await call("DELETE", "/api/folders/..%2Funits")).status, 400, "traversal that survives URL normalisation");
  assert.equal((await call("DELETE", "/api/folders/Units")).status, 400);
  assert.equal((await call("DELETE", "/api/folders/a/b")).status, 400);
  assert.ok(!fs.existsSync(path.join(root, "packs", "oaxaca")));
  assert.deepEqual(fs.readdirSync(path.join(root, "packs")), ["2026-10-19-market-gentle.yaml"]);

  assert.deepEqual(subjects().slice(0, subjects().length - commits), [
    "packs: folder oaxaca deleted",
    "packs: deleted oaxaca/2026-10-20-mezcal-slowly",
    "packs: moved 2026-10-20-mezcal-slowly to oaxaca",
    "packs: deleted oaxaca/2026-10-20-mezcal-slowly",
    "packs: saved oaxaca/2026-10-20-mezcal-slowly",
    "packs: moved oaxaca/2026-10-20-mezcal-slowly to no folder",
    "packs: renamed oaxaca/2026-10-20-mezcal to oaxaca/2026-10-20-mezcal-slowly",
    "packs: saved oaxaca/2026-10-20-mezcal",
    "packs: folder oaxaca created",
  ]);
  // only content/packs was ever staged: a stray change elsewhere stays uncommitted
  fs.writeFileSync(path.join(root, "stray.txt"), "untouched\n");
  await call("PUT", "/api/packs/2026-10-21-x", { ...pack, title: "X" });
  assert.match(git("status", "--porcelain"), /\?\? content\/stray\.txt/);
  await call("DELETE", "/api/packs/2026-10-21-x");
  fs.rmSync(path.join(root, "stray.txt"));
});

test("a git failure is reported beside a successful write, not as a failed request", async () => {
  const noRepo = fs.mkdtempSync(path.join(os.tmpdir(), "lingo-dojo-norepo-"));
  const quiet = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(" "));
  process.env.LINGO_REPO_ROOT = noRepo;
  try {
    const r = await call("PUT", "/api/packs/2026-10-22-orphan", { ...pack, title: "Orphan" });
    assert.equal(r.status, 200);
    assert.equal(r.body.pack.id, "2026-10-22-orphan");
    assert.equal(r.body.commit, null);
    assert.match(r.body.error, /git did not commit/);
    assert.ok(fs.existsSync(path.join(root, "packs", "2026-10-22-orphan.yaml")), "the write stands");
    assert.ok(logged.some((l) => /packs: commit failed \(saved 2026-10-22-orphan\)/.test(l)), logged.join("\n"));
  } finally {
    process.env.LINGO_REPO_ROOT = repo;
    console.error = quiet;
    fs.rmSync(path.join(root, "packs", "2026-10-22-orphan.yaml"));
    fs.rmSync(noRepo, { recursive: true, force: true });
  }
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
