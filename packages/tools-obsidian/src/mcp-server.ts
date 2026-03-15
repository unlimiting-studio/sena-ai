import { createInterface } from 'node:readline'

const COUCHDB_URL = process.env.COUCHDB_URL!
const COUCHDB_USER = process.env.COUCHDB_USER!
const COUCHDB_PASSWORD = process.env.COUCHDB_PASSWORD!
const COUCHDB_DATABASE = process.env.COUCHDB_DATABASE ?? 'obsidian'

for (const key of ['COUCHDB_URL', 'COUCHDB_USER', 'COUCHDB_PASSWORD']) {
  if (!process.env[key]) {
    console.error(`${key} is required`)
    process.exit(1)
  }
}

// CouchDB URL with auth
const dbUrl = new URL(`/${COUCHDB_DATABASE}`, COUCHDB_URL)
const authHeader = 'Basic ' + Buffer.from(`${COUCHDB_USER}:${COUCHDB_PASSWORD}`).toString('base64')

async function couchRequest(path: string, options: RequestInit = {}): Promise<any> {
  const url = new URL(path, dbUrl.toString() + '/')
  const res = await fetch(url.toString(), {
    ...options,
    headers: {
      ...options.headers as Record<string, string>,
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  })
  return res.json()
}

// Obsidian LiveSync stores notes as CouchDB documents.
// Document ID is typically the file path.
// Content is stored in various formats — we handle the common case.

// === Tool definitions ===

const tools = [
  {
    name: 'obsidian_list_notes',
    description: 'List notes in the Obsidian vault',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Path prefix to filter (optional)' },
        limit: { type: 'number', description: 'Max notes to return (default 100)' },
      },
    },
  },
  {
    name: 'obsidian_read_note',
    description: 'Read a specific note by path',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Note path (e.g., "daily/2024-01-01.md")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'obsidian_write_note',
    description: 'Create or update a note',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Note path' },
        content: { type: 'string', description: 'Note content (Markdown)' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'obsidian_search_notes',
    description: 'Search notes by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
]

// === Tool implementations ===

async function executeTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'obsidian_list_notes': {
      const { prefix, limit = 100 } = args
      const params: Record<string, string> = {
        limit: String(limit),
        include_docs: 'false',
      }
      if (prefix) {
        params.startkey = JSON.stringify(prefix)
        params.endkey = JSON.stringify(prefix + '\ufff0')
      }
      const query = new URLSearchParams(params).toString()
      const result = await couchRequest(`_all_docs?${query}`)
      const notes = (result.rows ?? [])
        .map((row: any) => row.id)
        .filter((id: string) => id.endsWith('.md') && !id.startsWith('_'))
      return JSON.stringify(notes, null, 2)
    }

    case 'obsidian_read_note': {
      const { path } = args
      const doc = await couchRequest(encodeURIComponent(path))
      if (doc.error) {
        return JSON.stringify({ error: doc.error, reason: doc.reason })
      }
      // LiveSync stores content in 'data' field or directly
      const content = doc.data ?? doc.content ?? doc.body ?? ''
      // Handle chunked content (LiveSync splits large docs)
      if (typeof content === 'string') {
        return content
      }
      return JSON.stringify(content)
    }

    case 'obsidian_write_note': {
      const { path, content } = args
      // Check if document exists (to get _rev for update)
      let rev: string | undefined
      try {
        const existing = await couchRequest(encodeURIComponent(path))
        if (existing._rev) rev = existing._rev
      } catch {
        // Document doesn't exist — create new
      }

      const doc: any = {
        _id: path,
        data: content,
        mtime: Date.now(),
        ctime: Date.now(),
        size: content.length,
        type: 'plain',
      }
      if (rev) doc._rev = rev

      const result = await couchRequest(encodeURIComponent(path), {
        method: 'PUT',
        body: JSON.stringify(doc),
      })
      return JSON.stringify({ ok: result.ok, id: result.id, rev: result.rev })
    }

    case 'obsidian_search_notes': {
      const { query, limit = 20 } = args
      // Use CouchDB _find with regex or Mango query
      // Fallback: list all docs and filter (not ideal for large vaults)
      const result = await couchRequest('_all_docs?include_docs=true&limit=1000')
      const matches = (result.rows ?? [])
        .filter((row: any) => {
          if (row.id.startsWith('_')) return false
          if (!row.id.endsWith('.md')) return false
          const content = row.doc?.data ?? row.doc?.content ?? ''
          return typeof content === 'string' && content.toLowerCase().includes(query.toLowerCase())
        })
        .slice(0, limit)
        .map((row: any) => ({
          path: row.id,
          snippet: extractSnippet(row.doc?.data ?? row.doc?.content ?? '', query),
        }))
      return JSON.stringify(matches, null, 2)
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function extractSnippet(content: string, query: string): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return content.slice(0, 100)
  const start = Math.max(0, idx - 50)
  const end = Math.min(content.length, idx + query.length + 50)
  return (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '')
}

// === JSON-RPC server ===

function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function handleRequest(id: number | string, method: string, params: any): void {
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sena-obsidian-mcp', version: '0.0.1' },
        },
      })
      break

    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools } })
      break

    case 'tools/call':
      executeTool(params.name, params.arguments ?? {})
        .then((text) => {
          send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }] },
          })
        })
        .catch((err) => {
          send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
              isError: true,
            },
          })
        })
      break

    default:
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    const msg = JSON.parse(line)
    if (msg.method && msg.id !== undefined) {
      handleRequest(msg.id, msg.method, msg.params)
    }
  } catch {
    // Ignore
  }
})
