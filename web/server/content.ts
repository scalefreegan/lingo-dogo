import type { IncomingMessage, ServerResponse } from "node:http";
import { assemble } from "../../scripts/assemble.mjs";
import {
  ID_RE, PACK_ID_RE, createFolder, deleteFolder, deletePack, listFolders, loadContent, movePack, renamePack, savePack,
  saveProfile, writeExport,
} from "../../scripts/content.mjs";
import type {
  AssembleRequest, AssembleResult, Committed, ContentReply, ExportRequest, ExportResult, FolderDeleteReply, FolderReply,
  Pack, PackDeleteReply, PackReply, PackWriteReply, PacksReply, PickerKey, ProfileReply, ProfileRequest,
} from "../shared/wire.ts";
import { commitPacks } from "./commit.ts";
import { HttpError, methodNotAllowed, readJsonBody, sendJson, subPath } from "./sse.ts";

// The content routes. All of them call loadContent() per request: content/ is
// small, the agent and the user's editor change it under the running server,
// and a cache would be one more thing to invalidate. The loader and assembler
// are the same modules the export CLI and the tests run.
//
//   GET    /api/content            library (schema, frame, profile, languages, units, scenarios, problems)
//   PUT    /api/profile            merge the picker keys into content/profile.yaml → {profile}
//   GET    /api/packs              {packs, folders, problems}
//   GET    /api/packs/:id          one pack; an id is <stem> or <folder>/<stem>
//   PUT    /api/packs/:id          write content/packs/<id>.yaml from a JSON pack → {pack, commit}
//   DELETE /api/packs/:id          → {ok, commit}
//   POST   /api/packs/:id/move     {folder} → {pack, commit}, pack.id being the new id
//   POST   /api/packs/:id/rename   {title} → {pack, commit}, likewise
//   POST   /api/folders            {name} → {folder, folders, commit}
//   DELETE /api/folders/:name      → {ok, folders, commit}; only an empty folder
//   POST   /api/assemble           {pack} → {markdown, warnings, stats}
//   POST   /api/export             {pack, id} → writes exports/<id>.md, {path, stats, warnings}
//
// Ids come from the request, so each is checked here (a 400 the user can
// read) and again inside the loader's write functions, which also prove the
// resolved path stays inside content/packs or exports/.
//
// Every pack write, move, rename or delete is followed by a `packs: …` commit
// of content/packs (commit.ts). The write is the result; the commit is
// reported beside it, and a git failure is `commit: null` plus `error` on a
// 200 rather than a failed request — the file is already on disk.

/** An export id: one segment. */
function checkId(id: unknown): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new HttpError(400, `invalid id ${JSON.stringify(id)}: use lowercase letters, digits and hyphens`);
  }
  return id;
}

/** A pack id from the path: `<stem>` or `<folder>/<stem>`. */
function checkPackId(id: unknown): string {
  if (typeof id !== "string" || !PACK_ID_RE.test(id)) {
    throw new HttpError(400, `invalid id ${JSON.stringify(id)}: use lowercase letters, digits and hyphens, with at most one folder`);
  }
  return id;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** The loader's refusals carry an errno-style `code`; the ones a client can
 *  act on become a status. Anything else is a 500, like any thrown error. */
const STATUS_BY_CODE: Record<string, number> = { EINVAL: 400, ENOENT: 404, EEXIST: 409, ENOTEMPTY: 409 };

function fromLoader<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    const status = typeof code === "string" ? STATUS_BY_CODE[code] : undefined;
    if (status) throw new HttpError(status, (e as Error).message);
    throw e;
  }
}

/** The commit half of a write reply. A git failure is logged and reported,
 *  never thrown: the write it was recording has already happened. */
async function committed(what: string): Promise<Committed> {
  const c = await commitPacks(what);
  if ("hash" in c) return { commit: { hash: c.hash, summary: c.summary } };
  if ("error" in c) {
    console.error(`[lingo-dojo] packs: commit failed (${what}): ${c.error}`);
    return { commit: null, error: `written, but git did not commit it: ${c.error}` };
  }
  return { commit: null };
}

export function handleContent(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") return methodNotAllowed(res, "GET");
  if (subPath(req)) return sendJson(res, 404, { error: "no such route" });
  const c = loadContent();
  const reply: ContentReply = {
    root: c.root, schema: c.schema, frame: c.frame, profile: c.profile, languages: c.languages,
    units: c.units, scenarios: c.scenarios, problems: c.problems,
  };
  sendJson(res, 200, reply);
}

/** The keys PUT /api/profile may write: what the pickers show. The rest of
 *  profile.yaml (name, goals, notes) is prose a person edits in the file or
 *  asks the agent for, and this route must not be a way to clobber it. */
const PICKER_KEYS: ReadonlySet<string> = new Set<PickerKey>(["native_language", "target_language", "target_variant", "level"]);
/** A language or variant name is a few words; this is a sanity bound, not a format. */
const MAX_PROFILE_VALUE = 80;

export async function handleProfile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (subPath(req)) return sendJson(res, 404, { error: "no such route" });
  if (req.method !== "PUT") return methodNotAllowed(res, "PUT");
  const body = await readJsonBody<unknown>(req);
  if (!isObject(body)) throw new HttpError(400, "body must be an object of profile keys");
  const patch: ProfileRequest = {};
  for (const [key, value] of Object.entries(body)) {
    if (!PICKER_KEYS.has(key)) throw new HttpError(400, `unknown profile key "${key}" (this route takes ${[...PICKER_KEYS].join(", ")})`);
    if (typeof value !== "string") throw new HttpError(400, `${key} must be a string`);
    if (value.length > MAX_PROFILE_VALUE) throw new HttpError(400, `${key} is too long (at most ${MAX_PROFILE_VALUE} characters)`);
    patch[key as PickerKey] = value;
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, "nothing to save: the body names no profile key");
  saveProfile(patch);
  // Read back through the loader, like packs: the reply is what the file now
  // says, not an echo of the request.
  sendJson(res, 200, { profile: loadContent().profile } satisfies ProfileReply);
}

export async function handlePacks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const seg = subPath(req);
  if (!seg) {
    if (req.method !== "GET") return methodNotAllowed(res, "GET");
    const { packs, problems } = loadContent();
    const packProblems = problems.filter((p) => /(^|[\\/])packs[\\/]/.test(p.file));
    sendJson(res, 200, { packs, folders: listFolders(), problems: packProblems } satisfies PacksReply);
    return;
  }
  // POST /api/packs/<id>/<action>: the action is the last segment and the id
  // the rest. Only POST has actions, so GET /api/packs/oaxaca/move is still
  // a lookup of the pack "oaxaca/move".
  const parts = seg.split("/");
  const action = req.method === "POST" && parts.length > 1 && ["move", "rename"].includes(parts[parts.length - 1]) ? parts.pop() : null;
  const id = checkPackId(parts.join("/"));
  // Every write reads back through the loader, so the reply is what the file
  // now says (and what GET /api/packs will list), not an echo of the request.
  const readBack = (packId: string, verb: string): Pack => {
    const pack = loadContent().packs.find((p) => p.id === packId);
    if (!pack) throw new Error(`pack ${packId} was ${verb} but does not load back`);
    return pack;
  };

  if (action === "move") {
    const body = await readJsonBody<unknown>(req);
    if (!isObject(body) || typeof body.folder !== "string") throw new HttpError(400, 'body must be {folder} ("" for no folder)');
    const folder = body.folder;
    const newId = fromLoader(() => movePack(id, folder));
    const pack = readBack(newId, "moved");
    sendJson(res, 200, { pack, ...(await committed(`moved ${id} to ${folder || "no folder"}`)) } satisfies PackWriteReply);
    return;
  }
  if (action === "rename") {
    const body = await readJsonBody<unknown>(req);
    const title = isObject(body) ? body.title : undefined;
    if (typeof title !== "string" || !title.trim()) throw new HttpError(400, "body must be {title}, and a pack needs a title");
    const newId = fromLoader(() => renamePack(id, title));
    const pack = readBack(newId, "renamed");
    sendJson(res, 200, { pack, ...(await committed(`renamed ${id} to ${newId}`)) } satisfies PackWriteReply);
    return;
  }
  if (req.method === "GET") {
    const pack = loadContent().packs.find((p) => p.id === id);
    if (!pack) return sendJson(res, 404, { error: `no pack "${id}"` });
    sendJson(res, 200, { pack } satisfies PackReply);
    return;
  }
  if (req.method === "PUT") {
    const body = await readJsonBody<unknown>(req);
    if (!isObject(body)) throw new HttpError(400, "body must be a pack object");
    if (typeof body.title !== "string" || !body.title.trim()) throw new HttpError(400, "a pack needs a title");
    const title = body.title.trim();
    const created = typeof body.created === "string" && body.created ? body.created : new Date().toISOString();
    fromLoader(() => savePack(id, { ...body, title, created }));
    const pack = readBack(id, "written");
    sendJson(res, 200, { pack, ...(await committed(`saved ${id}`)) } satisfies PackWriteReply);
    return;
  }
  if (req.method === "DELETE") {
    if (!fromLoader(() => deletePack(id))) return sendJson(res, 404, { error: `no pack "${id}"` });
    sendJson(res, 200, { ok: true, ...(await committed(`deleted ${id}`)) } satisfies PackDeleteReply);
    return;
  }
  methodNotAllowed(res, "GET, PUT, DELETE");
}

export async function handleFolders(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const name = subPath(req);
  if (!name) {
    if (req.method !== "POST") return methodNotAllowed(res, "POST");
    const body = await readJsonBody<unknown>(req);
    if (!isObject(body) || typeof body.name !== "string") throw new HttpError(400, "body must be {name}");
    const folder = body.name;
    fromLoader(() => createFolder(folder)); // EINVAL on a bad name → 400, EEXIST → 409
    sendJson(res, 200, { folder, folders: listFolders(), ...(await committed(`folder ${folder} created`)) } satisfies FolderReply);
    return;
  }
  if (req.method !== "DELETE") return methodNotAllowed(res, "DELETE");
  if (!fromLoader(() => deleteFolder(name))) return sendJson(res, 404, { error: `no folder "${name}"` });
  sendJson(res, 200, { ok: true, folders: listFolders(), ...(await committed(`folder ${name} deleted`)) } satisfies FolderDeleteReply);
}

export async function handleAssemble(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const body = await readJsonBody<Partial<AssembleRequest>>(req);
  if (!isObject(body) || !isObject(body.pack)) throw new HttpError(400, "body must be {pack}");
  sendJson(res, 200, assemble(loadContent(), body.pack) satisfies AssembleResult);
}

export async function handleExport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return methodNotAllowed(res, "POST");
  const body = await readJsonBody<Partial<ExportRequest>>(req);
  if (!isObject(body) || !isObject(body.pack)) throw new HttpError(400, "body must be {pack, id}");
  const id = checkId(body.id);
  const { markdown, stats, warnings } = assemble(loadContent(), body.pack);
  const path = writeExport(id, markdown);
  sendJson(res, 200, { path, stats, warnings } satisfies ExportResult);
}
