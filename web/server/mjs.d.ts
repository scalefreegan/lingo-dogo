// The server middleware reuses the repo-root .mjs modules (shared with the
// export CLI and the tests). They are plain JS, so tsc knows nothing of them
// beyond what this file says. Copied in shape from Atlas.
//
// Each module the server imports is declared precisely, against
// shared/wire.ts, so a route handler holds a typed value instead of casting an
// `any`, and a change to a wire type reaches every call site. These are still
// a promise about untyped code: scripts/tests/ (the loader, assembler and
// http tests) are what check that the .mjs half keeps it. Each block declares
// only what the server imports, so a new import fails to compile until it is
// declared here.
//
// ORDER MATTERS. The modules are matched by pattern (an ambient declaration
// cannot name a relative path), and tsc settles a tie between patterns with
// the same prefix in favour of the one declared first. The specific modules
// must stay above the catch-all, or it wins and types them all as `any`.
//
// Types come in through `import("…")` type queries rather than an `import`
// statement: a top-level import would make this file a module, and a pattern
// declaration inside a module is an augmentation, which tsc refuses.

declare module "*/scripts/content.mjs" {
  /** One kebab-case segment: the guard on export ids and folder names. */
  export const ID_RE: RegExp;
  /** `<stem>` or `<folder>/<stem>`: the guard on pack ids from a request. */
  export const PACK_ID_RE: RegExp;
  /** Absolute path of the repo (from import.meta.url, never process.cwd()). */
  export const REPO_ROOT: string;
  export function contentRoot(): string;
  export function exportsDir(): string;
  export function packsDir(root?: string): string;
  /** Never throws; bad files land in `problems`. */
  export function loadContent(root?: string): import("../shared/wire.ts").ContentReply & {
    packs: import("../shared/wire.ts").Pack[];
  };
  /** Throws on an id PACK_ID_RE rejects or a path outside content/packs. */
  export function savePack(id: string, pack: unknown, root?: string): string;
  /** False when there was no such pack. Throws on a bad id. */
  export function deletePack(id: string, root?: string): boolean;
  // The folder operations and the pack moves throw an Error whose `code` is
  // an errno name — EINVAL (bad name or id), ENOENT, EEXIST, ENOTEMPTY — which
  // the routes map to a status.
  /** Every directory under content/packs, sorted. */
  export function listFolders(root?: string): string[];
  export function createFolder(name: string, root?: string): string;
  /** False when there was no such folder; ENOTEMPTY when it holds a pack. */
  export function deleteFolder(name: string, root?: string): boolean;
  /** Returns the new id. "" moves the pack to the top level. */
  export function movePack(id: string, folder: string, root?: string): string;
  /** Returns the new id (`<date>-<slug of title>` in the same folder). */
  export function renamePack(id: string, title: string, root?: string): string;
  /** Merges the patch into content/profile.yaml in place (a blank value
   *  removes the key). Throws when the existing file is not a YAML mapping. */
  export function saveProfile(patch: import("../shared/wire.ts").ProfileRequest, root?: string): string;
  /** Throws on an id ID_RE rejects or a path outside exports/. */
  export function writeExport(id: string, markdown: string, dir?: string): string;
}

declare module "*/scripts/assemble.mjs" {
  /** Pure and deterministic; never throws on a malformed pack. */
  export function assemble(
    content: Pick<import("../shared/wire.ts").ContentReply, "schema" | "frame" | "profile" | "units" | "scenarios">,
    pack: unknown,
  ): import("../shared/wire.ts").AssembleResult;
}

declare module "*/scripts/claude.mjs" {
  export const AGENT_MODELS: import("../shared/wire.ts").AgentModel[];
  export const DEFAULT_MODEL: string;
  export function isAgentModel(id: unknown): id is string;
  /** A sentence for a known headless-CLI failure (sign-in, usage limit,
   *  overload), or null. */
  export function failureHint(text: string): string | null;
  /** The agent's final reply plus the envelope's accounting. */
  export interface ClaudeResult {
    text: string;
    costUsd: number | null;
    numTurns: number | null;
    durationMs: number | null;
    usage: Record<string, unknown> | null;
    permissionDenials: unknown[];
    raw: Record<string, unknown>;
  }
  /** Spawns `claude -p` in the sandbox buildArgs() pins (see the test).
   *  `kill()` and `signal` both SIGKILL the process group. */
  export function startClaude(opts: {
    prompt: string;
    systemPrompt?: string;
    model?: string;
    cwd?: string;
    signal?: AbortSignal;
    maxTurns?: number;
    timeoutSec?: number;
  }): { result: Promise<ClaudeResult>; kill: () => void };
}

// Everything else: untyped.
declare module "*.mjs";
