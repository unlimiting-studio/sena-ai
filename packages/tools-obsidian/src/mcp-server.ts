/**
 * Obsidian MCP Server
 *
 * Exposes Obsidian note operations via CouchDB LiveSync as MCP tools.
 * Runs as a standalone process communicating via stdio JSON-RPC.
 *
 * Tools exposed:
 * - obsidian_list_notes: List notes in the vault
 * - obsidian_read_note: Read a specific note
 * - obsidian_write_note: Create or update a note
 * - obsidian_search_notes: Search notes by keyword
 *
 * TODO: Implement full MCP server protocol
 */

const requiredEnv = ['COUCHDB_URL', 'COUCHDB_USER', 'COUCHDB_PASSWORD']
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`${key} is required`)
    process.exit(1)
  }
}

console.error('Obsidian MCP Server started (stub)')
