import type { IncomingMessage, ServerResponse } from "node:http";
import { assemble } from "../../scripts/assemble.mjs";
import { ID_RE, deletePack, loadContent, savePack, saveProfile, writeExport } from "../../scripts/content.mjs";
import type {
  AssembleRequest, AssembleResult, ContentReply, ExportRequest, ExportResult, Pack, PackReply, PacksReply,
  PickerKey, ProfileReply, ProfileRequest,
} from "../shared/wire.ts";
import { HttpError, methodNotAllowed, readJsonBody, sendJson, subPath } from "./sse.ts";

// The content routes. All of them call loadContent() per request: content/ is
// small, the agent and the user's editor change it under the running server,
// and a cache would be one more thing to invalidate. The loader and assembler
// are the same modules the export CLI and the tests run.
//
//   GET    /api/content        library (schema, frame, profile, languages, units, scenarios, problems)
//   PUT    /api/profile        merge the picker keys into content/profile.yaml → {profile}
//   GET    /api/packs          saved packs
//   GET    /api/packs/:id      one pack
//   PUT    /api/packs/:id      write content/packs/<id>.yaml from a JSON pack
//   DELETE /api/packs/:id
//   POST   /api/assemble       {pack} → {markdown, warnings, stats}
//   POST   /api/export         {pack, id} → writes exports/<id>.md, {path, stats, warnings}
//
// Ids come from the request, so each is checked against ID_RE here (a 400 the
// user can read) and again inside savePack/deletePack/writeExport, which also
// prove the resolved path stays inside content/packs or exports/.

function checkId(id: unknown): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new HttpError(400, `invalid id ${JSON.stringify(id)}: use lowercase letters, digits and hyphens`);
  }
  return id;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
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
    sendJson(res, 200, { packs, problems: packProblems } satisfies PacksReply);
    return;
  }
  const id = checkId(seg);
  const find = (): Pack | undefined => loadContent().packs.find((p) => p.id === id);

  if (req.method === "GET") {
    const pack = find();
    if (!pack) return sendJson(res, 404, { error: `no pack "${id}"` });
    sendJson(res, 200, { pack } satisfies PackReply);
    return;
  }
  if (req.method === "PUT") {
    const body = await readJsonBody<unknown>(req);
    if (!isObject(body)) throw new HttpError(400, "body must be a pack object");
    if (typeof body.title !== "string" || !body.title.trim()) throw new HttpError(400, "a pack needs a title");
    const created = typeof body.created === "string" && body.created ? body.created : new Date().toISOString();
    savePack(id, { ...body, title: body.title.trim(), created });
    // Read back through the loader, so the reply is what the file now says
    // (and what GET /api/packs will list), not an echo of the request.
    const pack = find();
    if (!pack) throw new Error(`pack ${id} was written but does not load back`);
    sendJson(res, 200, { pack } satisfies PackReply);
    return;
  }
  if (req.method === "DELETE") {
    if (!deletePack(id)) return sendJson(res, 404, { error: `no pack "${id}"` });
    sendJson(res, 200, { ok: true });
    return;
  }
  methodNotAllowed(res, "GET, PUT, DELETE");
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
