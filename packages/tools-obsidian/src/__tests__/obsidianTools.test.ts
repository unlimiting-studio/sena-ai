import { describe, it, expect } from 'vitest'
import { obsidianTools } from '../obsidianTools.js'

describe('obsidianTools', () => {
  it('creates a ToolPort with correct name and type', () => {
    const tool = obsidianTools({
      couchdbUrl: 'http://localhost:5984',
      couchdbUser: 'admin',
      couchdbPassword: 'password',
    })

    expect(tool.name).toBe('obsidian')
    expect(tool.type).toBe('mcp-stdio')
  })

  it('generates MCP config with credentials in env', () => {
    const tool = obsidianTools({
      couchdbUrl: 'http://localhost:5984',
      couchdbUser: 'admin',
      couchdbPassword: 'password',
      database: 'my-vault',
    })
    const config = tool.toMcpConfig({ name: 'claude' }) as any

    expect(config.command).toBe('node')
    expect(config.env.COUCHDB_URL).toBe('http://localhost:5984')
    expect(config.env.COUCHDB_USER).toBe('admin')
    expect(config.env.COUCHDB_PASSWORD).toBe('password')
    expect(config.env.COUCHDB_DATABASE).toBe('my-vault')
  })

  it('uses default database name', () => {
    const tool = obsidianTools({
      couchdbUrl: 'http://localhost:5984',
      couchdbUser: 'admin',
      couchdbPassword: 'password',
    })
    const config = tool.toMcpConfig({ name: 'codex' }) as any
    expect(config.env.COUCHDB_DATABASE).toBe('obsidian')
  })
})
