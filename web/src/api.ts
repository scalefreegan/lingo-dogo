/* Typed fetch layer (Atlas pattern). Every call goes to the same-origin Vite
 * middleware in server/ (which enforces the same-origin check in its own
 * wrap()). This is the only file in src/ that knows URL shapes — components
 * import a named function per endpoint, never req() itself. */

import type {
  AssembleResult, ContentReply, ExportRequest, ExportResult, PackInput, PackReply, PacksReply,
} from "./types";

/** A non-2xx reply; `message` is the server's `{error}` sentence. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null;
    throw new ApiError(typeof err === "string" ? err : text.slice(0, 200) || `${res.status} ${res.statusText}`, res.status);
  }
  return body as T;
}

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** GET /api/content — re-read from disk on every call. */
export function getContent(): Promise<ContentReply> {
  return req<ContentReply>("/api/content");
}

export function listPacks(): Promise<PacksReply> {
  return req<PacksReply>("/api/packs");
}

/** PUT /api/packs/:id — creates or overwrites content/packs/<id>.yaml. */
export function savePack(id: string, pack: PackInput): Promise<PackReply> {
  return req<PackReply>(`/api/packs/${encodeURIComponent(id)}`, json(pack, "PUT"));
}

export function assemblePack(pack: PackInput, signal?: AbortSignal): Promise<AssembleResult> {
  return req<AssembleResult>("/api/assemble", { ...json({ pack }), signal });
}

export function exportPack(id: string, pack: PackInput): Promise<ExportResult> {
  return req<ExportResult>("/api/export", json({ id, pack } satisfies ExportRequest));
}
