import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT, contentRoot } from "../../scripts/content.mjs";
import type { ChatCommit } from "../shared/wire.ts";

// Auto-commit of content/ after an agent turn, so every change the agent
// makes is one `git log` entry and one `git revert` away. Only content/ is
// ever staged: the rest of the working tree may be dirty with the user's own
// work and must stay that way. Never a push.

const execFileP = promisify(execFile);

/** Every git call is execFile with an argv — never a shell string, since the
 *  commit subject is agent-written text. */
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd, maxBuffer: 1 << 20 });
  return stdout;
}

/**
 * The commit subject from the agent's reply: the system prompt asks it to end
 * with one line saying what it changed, so the last non-empty line is the
 * summary. Markdown dressing (a bullet, bold, a "Summary:" label) is stripped
 * and the result cut to 72 characters, git's conventional subject width.
 */
export function commitSubject(reply: string): string {
  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  let line = lines[lines.length - 1] ?? "";
  line = line
    .replace(/^[-*•]\s+/, "")
    .replace(/^#+\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^(summary|changes?|changed)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) line = "content edited";
  const MAX = 72;
  return line.length > MAX ? `${line.slice(0, MAX - 1).trimEnd()}…` : line;
}

/**
 * Stage and commit whatever changed under the content directory. Resolves to
 * the SSE `commit` payload rather than throwing: a failed commit must reach
 * the UI as a line the user can read, not take down the stream after the
 * reply already went out.
 */
export async function commitContent(reply: string, { repoRoot = REPO_ROOT, contentDir = contentRoot() } = {}): Promise<ChatCommit> {
  // A pathspec relative to the repo, so `git status`/`add`/`commit` all name
  // the same tree regardless of how contentDir was spelled.
  const spec = path.relative(repoRoot, contentDir) || ".";
  try {
    const status = await git(["status", "--porcelain", "--", spec], repoRoot);
    if (!status.trim()) return { skipped: true };
    const summary = commitSubject(reply);
    // -A so a file the agent deleted or renamed is staged too; the pathspec
    // on `commit` means only these paths are recorded, leaving anything the
    // user had staged elsewhere in the index exactly as it was.
    await git(["add", "-A", "--", spec], repoRoot);
    await git(["commit", "-q", "-m", `agent: ${summary}`, "--", spec], repoRoot);
    const hash = (await git(["rev-parse", "--short", "HEAD"], repoRoot)).trim();
    return { hash, summary };
  } catch (e) {
    const err = e as Error & { stderr?: string };
    return { error: (err.stderr || err.message || String(e)).trim().slice(0, 500) };
  }
}
