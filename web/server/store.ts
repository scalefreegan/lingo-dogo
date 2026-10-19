import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MODEL, isAgentModel } from "../../scripts/claude.mjs";
import { REPO_ROOT } from "../../scripts/content.mjs";
import type { ChatMessage } from "../shared/wire.ts";

// Runtime state that is not content: the chat transcript and the model
// setting. Plain files under data/ (gitignored, created on demand), read on
// every call — the app is single-user and these are tiny, so a cache would
// only add a way for the file and the process to disagree.
//
//   data/chat.jsonl      one {role, text, ts} per line, appended per message
//   data/settings.json   {model}

/** LINGO_DATA_DIR when set (resolved against the repo root, like the content
 *  and exports overrides), else <repo>/data. Per call, so a test can point it
 *  at a temp dir. */
export function dataDir(): string {
  const override = process.env.LINGO_DATA_DIR;
  return override ? path.resolve(REPO_ROOT, override) : path.join(REPO_ROOT, "data");
}

const historyPath = () => path.join(dataDir(), "chat.jsonl");
const settingsPath = () => path.join(dataDir(), "settings.json");

const ROLES = new Set(["user", "assistant", "commit"]);

export function readHistory(): ChatMessage[] {
  let text: string;
  try {
    text = fs.readFileSync(historyPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: ChatMessage[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // A torn last line (the server died mid-append) is dropped, not fatal:
    // the transcript is a convenience, the content is the product.
    try {
      const m = JSON.parse(line) as Partial<ChatMessage>;
      if (typeof m.role === "string" && ROLES.has(m.role) && typeof m.text === "string") {
        out.push({ role: m.role, text: m.text, ts: typeof m.ts === "string" ? m.ts : "" });
      }
    } catch {
      /* skip */
    }
  }
  return out;
}

export function appendHistory(message: ChatMessage): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.appendFileSync(historyPath(), `${JSON.stringify(message)}\n`);
}

export function clearHistory(): void {
  try {
    fs.unlinkSync(historyPath());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/** The model agent runs use. Anything unreadable or outside the offered list
 *  falls back to the default, so a stale settings file can never spawn a
 *  model the UI doesn't offer. */
export function getModel(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as { model?: unknown };
    return isAgentModel(raw.model) ? raw.model : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function setModel(model: string): string {
  if (!isAgentModel(model)) throw new Error(`unknown model: ${model}`);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify({ model }, null, 2)}\n`);
  return model;
}
