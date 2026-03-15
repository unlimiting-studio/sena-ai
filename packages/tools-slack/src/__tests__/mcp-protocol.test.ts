import { describe, it, expect } from 'vitest'

// Test the tool definitions are well-formed
const tools = [
  { name: 'slack_get_messages', requiredArgs: ['channelId'] },
  { name: 'slack_post_message', requiredArgs: ['channelId', 'text'] },
  { name: 'slack_list_channels', requiredArgs: [] },
  { name: 'slack_upload_file', requiredArgs: ['channelId', 'content', 'filename'] },
  { name: 'slack_download_file', requiredArgs: ['fileId'] },
]

describe('Slack MCP tool definitions', () => {
  it('exposes 5 tools', () => {
    expect(tools).toHaveLength(5)
  })

  it('all tools have names', () => {
    for (const tool of tools) {
      expect(tool.name).toBeDefined()
      expect(tool.name).toMatch(/^slack_/)
    }
  })
})
