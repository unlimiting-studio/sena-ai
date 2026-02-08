import { CONFIG } from "../config.ts";

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

  async listNoteDocuments(
    prefix?: string,
    limit = 200,
  ): Promise<Array<NoteEntry | ChunkedEntry>> {
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
}

// --- Content reassembly ---

export async function reassembleContent(
  entry: NoteEntry | ChunkedEntry,
  client: CouchDBClient,
): Promise<string> {
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

const generateChunkId = (): string => {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
  let id = "";
  for (let i = 0; i < 14; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `h:${id}`;
};

// --- Write support ---

export async function writeNote(
  client: CouchDBClient,
  filepath: string,
  content: string,
): Promise<{ ok: boolean; path: string }> {
  const docId = path2id(filepath);
  const now = Date.now();

  // Check if document already exists
  let existingDoc: LiveSyncDocument | null = null;
  try {
    existingDoc = await client.getDocument(docId);
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("404"))) {
      throw err;
    }
  }

  // Build new chunk
  const chunkId = generateChunkId();

  // Write the leaf chunk
  await client.putDocument(chunkId, {
    _id: chunkId,
    data: content,
    type: "leaf",
  });

  // Build note document
  const noteDoc: Record<string, unknown> = {
    _id: docId,
    type: "plain",
    path: filepath,
    ctime: existingDoc && "ctime" in existingDoc ? existingDoc.ctime : now,
    mtime: now,
    size: new TextEncoder().encode(content).byteLength,
    children: [chunkId],
    eden: {},
  };

  if (existingDoc?._rev) {
    noteDoc._rev = existingDoc._rev;

    // Clean up old leaf chunks
    if ("children" in existingDoc && Array.isArray(existingDoc.children)) {
      for (const oldChunkId of existingDoc.children) {
        try {
          const oldChunk = await client.getDocument(oldChunkId);
          if (oldChunk._rev) {
            await client.deleteDocument(oldChunkId, oldChunk._rev);
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  await client.putDocument(docId, noteDoc);
  return { ok: true, path: filepath };
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
