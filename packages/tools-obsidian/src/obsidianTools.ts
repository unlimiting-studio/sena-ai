import type { McpToolPort, RuntimeInfo, McpConfig } from '@sena-ai/core'

export type ObsidianToolsOptions = {
  couchdbUrl: string
  couchdbUser: string
  couchdbPassword: string
  database?: string
}

/**
 * Creates a ToolPort for Obsidian MCP tools via CouchDB LiveSync.
 * Exposes: list_notes, read_note, write_note, search_notes
 */
export function obsidianTools(options: ObsidianToolsOptions): McpToolPort {
  const { couchdbUrl, couchdbUser, couchdbPassword, database = 'obsidian' } = options

  return {
    name: 'obsidian',
    type: 'mcp-stdio',
    toMcpConfig(_runtime: RuntimeInfo): McpConfig {
      return {
        command: 'node',
        args: [new URL('../dist/mcp-server.js', import.meta.url).pathname],
        env: {
          COUCHDB_URL: couchdbUrl,
          COUCHDB_USER: couchdbUser,
          COUCHDB_PASSWORD: couchdbPassword,
          COUCHDB_DATABASE: database,
        },
      }
    },
  }
}
