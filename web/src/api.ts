/* Typed fetch layer (Atlas pattern). Every call goes to the same-origin Vite
 * middleware in server/ (which enforces the same-origin check in its own
 * wrap()). This is the only file in src/ that knows URL shapes — components
 * import a named function per endpoint, never req() itself. */

import type {
  AssembleResult, ChatCommit, ChatDone, ChatError, ChatHeartbeat, ChatHistoryReply, ChatReply, ChatRequest, ChatStart,
  ContentReply, ExportRequest, ExportResult, FolderDeleteReply, FolderReply, FolderRequest, PackDeleteReply, PackInput,
  PackMoveRequest, PackRenameRequest, PackWriteReply, PacksReply, ProfileReply, ProfileRequest, SettingsReply, SettingsRequest,
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

/** PUT /api/profile — merges the picker keys into content/profile.yaml. */
export function saveProfile(patch: ProfileRequest): Promise<ProfileReply> {
  return req<ProfileReply>("/api/profile", json(patch, "PUT"));
}

/* --------------------------------- packs --------------------------------- */

/** A pack id in a URL: each segment encoded on its own, so the one slash of
 *  a folder id stays a path separator. */
function packUrl(id: string): string {
  return `/api/packs/${id.split("/").map(encodeURIComponent).join("/")}`;
}

/** GET /api/packs — the saved packs and the folders under content/packs. */
export function listPacks(): Promise<PacksReply> {
  return req<PacksReply>("/api/packs");
}

/** PUT /api/packs/:id — creates or overwrites content/packs/<id>.yaml and
 *  commits it. Every write below answers with the pack as it reads back and
 *  the commit that recorded it (see Committed in the wire types). */
export function savePack(id: string, pack: PackInput): Promise<PackWriteReply> {
  return req<PackWriteReply>(packUrl(id), json(pack, "PUT"));
}

export function deletePack(id: string): Promise<PackDeleteReply> {
  return req<PackDeleteReply>(packUrl(id), { method: "DELETE" });
}

/** POST /api/packs/:id/move — "" for the top level; the reply's pack.id is the new id. */
export function movePack(id: string, folder: string): Promise<PackWriteReply> {
  return req<PackWriteReply>(`${packUrl(id)}/move`, json({ folder } satisfies PackMoveRequest));
}

/** POST /api/packs/:id/rename — new title, and a file renamed to match. */
export function renamePack(id: string, title: string): Promise<PackWriteReply> {
  return req<PackWriteReply>(`${packUrl(id)}/rename`, json({ title } satisfies PackRenameRequest));
}

export function createFolder(name: string): Promise<FolderReply> {
  return req<FolderReply>("/api/folders", json({ name } satisfies FolderRequest));
}

/** DELETE /api/folders/:name — refused (409) unless the folder is empty. */
export function deleteFolder(name: string): Promise<FolderDeleteReply> {
  return req<FolderDeleteReply>(`/api/folders/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function assemblePack(pack: PackInput, signal?: AbortSignal): Promise<AssembleResult> {
  return req<AssembleResult>("/api/assemble", { ...json({ pack }), signal });
}

export function exportPack(id: string, pack: PackInput): Promise<ExportResult> {
  return req<ExportResult>("/api/export", json({ id, pack } satisfies ExportRequest));
}

/* --------------------------------- chat ---------------------------------- */

/** Handlers for the SSE events POST /api/chat emits (shapes in wire.ts). */
export interface ChatHandlers {
  start?: (d: ChatStart) => void;
  heartbeat?: (d: ChatHeartbeat) => void;
  message?: (d: ChatReply) => void;
  commit?: (d: ChatCommit) => void;
  error?: (d: ChatError) => void;
  done?: (d: ChatDone) => void;
}

/** EventSource can't POST, so the stream is parsed by hand (wine-guide
 *  pattern). Resolves when the server's terminal `done` arrives; a stream
 *  that ends without one is an error, not a quiet success. */
async function ssePost(url: string, body: unknown, handlers: ChatHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { ...json(body), signal });
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(detail || `${res.status} ${res.statusText}`, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let sawDone = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      if (event === "done") sawDone = true;
      try {
        const parsed: unknown = JSON.parse(data);
        (handlers as Record<string, ((d: unknown) => void) | undefined>)[event]?.(parsed);
      } catch {
        /* malformed frame */
      }
    }
  }
  if (!sawDone) throw new Error("stream ended unexpectedly — the server may have restarted; try again");
}

export function sendChat(message: string, handlers: ChatHandlers, signal?: AbortSignal): Promise<void> {
  return ssePost("/api/chat", { message } satisfies ChatRequest, handlers, signal);
}

export function getChatHistory(): Promise<ChatHistoryReply> {
  return req<ChatHistoryReply>("/api/chat/history");
}

export function clearChatHistory(): Promise<{ ok: true }> {
  return req<{ ok: true }>("/api/chat/history", { method: "DELETE" });
}

export function getSettings(): Promise<SettingsReply> {
  return req<SettingsReply>("/api/settings");
}

export function setModel(model: string): Promise<SettingsReply> {
  return req<SettingsReply>("/api/settings", json({ model } satisfies SettingsRequest, "PUT"));
}
