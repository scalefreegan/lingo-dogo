import type { IncomingMessage, ServerResponse } from "node:http";
import { assemble } from "../../scripts/assemble.mjs";
import { ID_RE, deletePack, loadContent, savePack, writeExport } from "../../scripts/content.mjs";
import type {
  AssembleRequest, AssembleResult, ContentReply, ExportRequest, ExportResult, Pack, PackReply, PacksReply,
} from "../shared/wire.ts";
import { HttpError, readJsonBody, sendJson } from "./sse.ts";

// The content routes. All of them call loadContent() per request: content/ is
// small, the agent and the user's editor change it under the running server,
// and a cache would be one more thing to invalidate. The loader and assembler
// are the same modules the export CLI and the tests run.
//
//   GET    /api/content        library (schema, frame, profile, units, scenarios, problems)
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

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.writeHead(405, { Allow: allow, "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `method not allowed (use ${allow})` }));
}

/** The path segment after the mount point, e.g. "/2026-10-19-x" → "2026-10-19-x".
 *  connect strips the mount prefix from req.url before the handler sees it. */
function subPath(req: IncomingMessage): string {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  let seg = pathname.replace(/^\/+|\/+$/g, "");
  try {
    seg = decodeURIComponent(seg);
  } catch {
    throw new HttpError(400, "malformed id");
  }
  return seg;
}

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
    root: c.root, schema: c.schema, frame: c.frame, profile: c.profile,
    units: c.units, scenarios: c.scenarios, problems: c.problems,
  };
  sendJson(res, 200, reply);
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
