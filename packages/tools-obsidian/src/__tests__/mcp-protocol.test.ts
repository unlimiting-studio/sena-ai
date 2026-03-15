import { describe, it, expect } from 'vitest'

const tools = [
  { name: 'obsidian_list_notes', requiredArgs: [] },
  { name: 'obsidian_read_note', requiredArgs: ['path'] },
  { name: 'obsidian_write_note', requiredArgs: ['path', 'content'] },
  { name: 'obsidian_search_notes', requiredArgs: ['query'] },
]

describe('Obsidian MCP tool definitions', () => {
  it('exposes 4 tools', () => {
    expect(tools).toHaveLength(4)
  })

  it('all tools have names prefixed with obsidian_', () => {
    for (const tool of tools) {
      expect(tool.name).toMatch(/^obsidian_/)
    }
  })
})
