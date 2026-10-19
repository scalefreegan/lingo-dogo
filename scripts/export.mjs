#!/usr/bin/env node
// CLI: render a saved pack to exports/<id>.md, the same file the app's Export
// button writes.
//   node scripts/export.mjs content/packs/<id>.yaml
//   npm run export -- content/packs/<id>.yaml
// The library comes from content/ (or LINGO_CONTENT_DIR); the pack can be any
// path, and its id is its filename stem. Warnings go to stderr and do not fail
// the run, matching the app; an unreadable or invalid pack exits 1.

import path from "node:path";
import { loadContent, loadPackFile, writeExport, ID_RE } from "./content.mjs";
import { assemble } from "./assemble.mjs";

function main(argv) {
  const file = argv[0];
  if (!file || argv.length > 1) {
    console.error("usage: node scripts/export.mjs content/packs/<id>.yaml");
    return 2;
  }
  const abs = path.resolve(file);
  const { pack, problems } = loadPackFile(abs);
  for (const p of problems) console.error(`${p.level}: ${p.file}: ${p.message}`);
  if (!pack) return 1;
  if (!ID_RE.test(pack.id)) {
    console.error(`error: "${pack.id}" is not a valid export id (lowercase letters, digits, hyphens); rename the pack file`);
    return 1;
  }

  const content = loadContent();
  // Content problems elsewhere in the library don't stop an export, but say
  // how many so a unit missing from the output is explainable.
  const errors = content.problems.filter((p) => p.level === "error");
  if (errors.length) console.error(`note: ${errors.length} content file(s) failed to load; run the app to see them`);

  const { markdown, warnings, stats } = assemble(content, pack);
  for (const w of warnings) console.error(`warning: ${w}`);
  const out = writeExport(pack.id, markdown);
  console.log(out);
  console.log(`${stats.words} words, ~${stats.tokens} tokens`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
