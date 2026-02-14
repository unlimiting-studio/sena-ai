import { CONFIG } from "../config.ts";
import { createHash, randomBytes } from "node:crypto";

// --- Type definitions for LiveSync CouchDB documents ---

/** Legacy format: inline data */
export interface NoteEntry {
  _id: string;
  _rev?: string;
  type: "notes";
  path: string;
  data: string;
  ctime: number;
  mtime: number;
  size: number;
  children?: never;
  eden?: never;
}

/** Modern format: chunked with children + optional eden */
export interface ChunkedEntry {
  _id: string;
  _rev?: string;
  type: "newnote" | "plain";
  path: string;
  data?: string;
  ctime: number;
  mtime: number;
  size: number;
  children: string[];
  eden?: Record<string, string>;
}

/** Leaf (chunk) document */
export interface LeafEntry {
  _id: string;
  _rev?: string;
  type: "leaf";
  data: string;
}

export type LiveSyncDocument = NoteEntry | ChunkedEntry | LeafEntry;

// --- Path helpers ---

/** Convert a vault-relative path to CouchDB document ID */
export const path2id = (filepath: string): string => {
  // CouchDB reserves IDs starting with '_', so LiveSync prefixes them with '/'
  if (filepath.startsWith("_")) {
    return `/${filepath}`;
  }
  return filepath;
};

/** Convert a CouchDB document ID back to a vault-relative path */
export const id2path = (docId: string): string => {
  if (docId.startsWith("/_")) {
    return docId.slice(1);
  }
  return docId;
};

// --- CouchDB HTTP Client ---

export class CouchDBClient {
  private baseUrl: string;
  private database: string;
  private authHeader: string;

  constructor(url: string, database: string, username: string, password: string) {
    this.baseUrl = url.replace(/\/+$/, "");
    this.database = database;
    this.authHeader = `Basic ${btoa(`${username}:${password}`)}`;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/${this.database}/${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`CouchDB ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async getDocument(docId: string): Promise<LiveSyncDocument> {
    return this.request<LiveSyncDocument>(encodeURIComponent(docId));
  }

  async listNoteDocuments(prefix?: string, limit = 200): Promise<Array<NoteEntry | ChunkedEntry>> {
    const params = new URLSearchParams({ include_docs: "true", limit: String(limit) });
    if (prefix) {
      const prefixId = path2id(prefix);
      params.set("startkey", JSON.stringify(prefixId));
      params.set("endkey", JSON.stringify(`${prefixId}\ufff0`));
    }

    const result = await this.request<{
      rows: Array<{ id: string; doc: LiveSyncDocument }>;
    }>(`_all_docs?${params.toString()}`);

    return result.rows
      .map((row) => row.doc)
      .filter((doc): doc is NoteEntry | ChunkedEntry => {
        if (!doc || !doc._id) return false;
        // Filter out design docs, local docs, and leaf chunks
        if (doc._id.startsWith("_design/")) return false;
        if (doc._id.startsWith("_local/")) return false;
        if (doc._id.startsWith("h:")) return false;
        if (doc.type === "leaf") return false;
        return doc.type === "notes" || doc.type === "newnote" || doc.type === "plain";
      });
  }

  async putDocument(docId: string, body: Record<string, unknown>): Promise<{ ok: boolean; id: string; rev: string }> {
    return this.request<{ ok: boolean; id: string; rev: string }>(encodeURIComponent(docId), {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async deleteDocument(docId: string, rev: string): Promise<{ ok: boolean; id: string; rev: string }> {
    return this.request<{ ok: boolean; id: string; rev: string }>(
      `${encodeURIComponent(docId)}?rev=${encodeURIComponent(rev)}`,
      { method: "DELETE" },
    );
  }

  async bulkGetDocuments(keys: string[]): Promise<Map<string, LiveSyncDocument>> {
    if (keys.length === 0) return new Map();

    const result = await this.request<{
      rows: Array<{ id: string; doc?: LiveSyncDocument; error?: unknown }>;
    }>(`_all_docs?include_docs=true`, {
      method: "POST",
      body: JSON.stringify({ keys }),
    });

    const map = new Map<string, LiveSyncDocument>();
    for (const row of result.rows) {
      if (row.doc) {
        map.set(row.id, row.doc);
      }
    }
    return map;
  }

  async findNoteDocumentByPath(filepath: string): Promise<NoteEntry | ChunkedEntry | null> {
    try {
      const result = await this.request<{
        docs: LiveSyncDocument[];
      }>("_find", {
        method: "POST",
        body: JSON.stringify({
          selector: {
            path: { $eq: filepath },
            type: { $in: ["notes", "newnote", "plain"] },
          },
          limit: 2,
        }),
      });

      const doc = result.docs.find(
        (d): d is NoteEntry | ChunkedEntry => d.type === "notes" || d.type === "newnote" || d.type === "plain",
      );
      return doc ?? null;
    } catch {
      // Some CouchDB deployments may not allow _find. Fallback to null.
      return null;
    }
  }
}

// --- Content reassembly ---

export async function reassembleContent(entry: NoteEntry | ChunkedEntry, client: CouchDBClient): Promise<string> {
  // Legacy format: data is inline
  if (entry.type === "notes") {
    return entry.data;
  }

  // Modern format: chunked
  const children = entry.children ?? [];
  if (children.length === 0) {
    return entry.data ?? "";
  }

  const eden = entry.eden ?? {};

  // Collect chunk data: first check eden, then bulk-fetch the rest
  const missingKeys: string[] = [];
  for (const childId of children) {
    if (!(childId in eden)) {
      missingKeys.push(childId);
    }
  }

  const fetched = await client.bulkGetDocuments(missingKeys);

  const parts: string[] = [];
  for (const childId of children) {
    if (childId in eden) {
      parts.push(eden[childId]);
    } else {
      const leaf = fetched.get(childId);
      if (leaf && "data" in leaf && typeof leaf.data === "string") {
        parts.push(leaf.data);
      }
    }
  }

  return parts.join("");
}

// --- Chunk ID generation ---

const generateChunkId = (content: string): string => `h:${createHash("sha1").update(content).digest("hex")}`;

const isNoteEntry = (doc: LiveSyncDocument | null): doc is NoteEntry | ChunkedEntry => {
  if (!doc) return false;
  return doc.type === "notes" || doc.type === "newnote" || doc.type === "plain";
};

const hasUnsupportedMetadataMode = (doc: NoteEntry | ChunkedEntry): boolean => {
  const maybeEncrypted = doc as { e_?: unknown };
  return Boolean(doc.path?.startsWith("f:") || maybeEncrypted.e_ === true);
};

const putChunk = async (client: CouchDBClient, content: string): Promise<string> => {
  const baseChunkId = generateChunkId(content);
  let chunkId = baseChunkId;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await client.putDocument(chunkId, {
        _id: chunkId,
        data: content,
        type: "leaf",
      });
      return chunkId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("409")) {
        throw err;
      }

      // If the chunk already exists with the same data, reuse it.
      try {
        const existing = await client.getDocument(chunkId);
        if (existing.type === "leaf" && existing.data === content) {
          return chunkId;
        }
      } catch {
        // Fall through to retry with a random suffix.
      }

      chunkId = `${baseChunkId}:${randomBytes(4).toString("hex")}`;
    }
  }

  throw new Error("leaf chunk 생성에 실패했습니다.");
};

// --- Write support ---

export async function writeNote(
  client: CouchDBClient,
  filepath: string,
  content: string,
): Promise<{ ok: boolean; path: string }> {
  const fallbackDocId = path2id(filepath);
  const now = Date.now();
  const encoder = new TextEncoder();

  // Resolve existing document by ID first, then by exact path.
  let existingDoc: LiveSyncDocument | null = null;
  let targetDocId = fallbackDocId;
  try {
    existingDoc = await client.getDocument(fallbackDocId);
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("404"))) {
      throw err;
    }
  }
  if (!isNoteEntry(existingDoc)) {
    existingDoc = await client.findNoteDocumentByPath(filepath);
    if (existingDoc) {
      targetDocId = existingDoc._id;
    }
  }

  if (existingDoc && hasUnsupportedMetadataMode(existingDoc)) {
    throw new Error(
      "LiveSync의 path obfuscation/property encryption(e_)이 활성화된 DB는 직접 쓰기를 지원하지 않습니다. 안전을 위해 저장을 중단했습니다.",
    );
  }

  const chunkId = await putChunk(client, content);

  // For legacy notes, keep inline format to avoid mixed-mode corruption.
  if (existingDoc && existingDoc.type === "notes") {
    let baseDoc: NoteEntry = existingDoc;
    for (let attempt = 0; attempt < 3; attempt++) {
      const noteDoc: Record<string, unknown> = {
        _id: baseDoc._id,
        _rev: baseDoc._rev,
        type: "notes",
        path: baseDoc.path,
        data: content,
        ctime: baseDoc.ctime || now,
        mtime: now,
        size: encoder.encode(content).byteLength,
      };

      try {
        await client.putDocument(baseDoc._id, noteDoc);
        return { ok: true, path: filepath };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("409") || attempt === 2) {
          throw err;
        }
        const refreshed = await client.getDocument(baseDoc._id);
        if (!isNoteEntry(refreshed) || refreshed.type !== "notes") {
          throw new Error("노트 저장 중 문서 타입이 변경되어 중단했습니다.");
        }
        baseDoc = refreshed;
      }
    }
    throw new Error("노트 저장에 실패했습니다.");
  }

  // Chunked format. Important: do NOT delete old chunks; chunks can be shared.
  let baseDoc: NoteEntry | ChunkedEntry | null = existingDoc && isNoteEntry(existingDoc) ? existingDoc : null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const noteType = baseDoc && (baseDoc.type === "newnote" || baseDoc.type === "plain") ? baseDoc.type : "plain";

    const noteDoc: Record<string, unknown> = {
      ...(baseDoc ? baseDoc : {}),
      _id: targetDocId,
      type: noteType,
      path: baseDoc?.path ?? filepath,
      ctime: baseDoc && "ctime" in baseDoc ? baseDoc.ctime : now,
      mtime: now,
      size: encoder.encode(content).byteLength,
      children: [chunkId],
      // Keep latest chunk in eden to avoid temporary "missing chunk" reads during replication.
      eden: { [chunkId]: content },
    };

    if (baseDoc?._rev) {
      noteDoc._rev = baseDoc._rev;
    }

    try {
      await client.putDocument(targetDocId, noteDoc);
      return { ok: true, path: filepath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("409") || attempt === 2) {
        throw err;
      }
      const refreshed = await client.getDocument(targetDocId);
      if (isNoteEntry(refreshed)) {
        if (hasUnsupportedMetadataMode(refreshed)) {
          throw new Error("충돌 재시도 중 LiveSync 암호화 메타데이터(e_/f:)가 감지되어 저장을 중단했습니다.");
        }
        baseDoc = refreshed;
      } else {
        throw new Error("충돌 재시도 중 문서 타입이 변경되어 저장을 중단했습니다.");
      }
    }
  }

  throw new Error("노트 저장에 실패했습니다.");
}

// --- Singleton-style factory ---

let _clientInstance: CouchDBClient | null = null;

export const getCouchDBClient = (): CouchDBClient | null => {
  if (!CONFIG.COUCHDB_URL) return null;
  if (!_clientInstance) {
    _clientInstance = new CouchDBClient(
      CONFIG.COUCHDB_URL,
      CONFIG.COUCHDB_DATABASE,
      CONFIG.COUCHDB_USER,
      CONFIG.COUCHDB_PASSWORD,
    );
  }
  return _clientInstance;
};
