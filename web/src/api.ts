/* Typed fetch layer (Atlas pattern). Every call goes to the same-origin Vite
 * middleware in server/ (which enforces the same-origin check in its own
 * wrap()). This is the only file in src/ that knows URL shapes — components
 * import a named function per endpoint, never req() itself. */

import type {
  AssembleResult, ChatCommit, ChatDone, ChatError, ChatHeartbeat, ChatHistoryReply, ChatReply, ChatRequest, ChatStart,
  ContentReply, ExportRequest, ExportResult, PackInput, PackReply, PacksReply, SettingsReply, SettingsRequest,
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
