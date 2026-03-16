import { describe, it, expect } from 'vitest'
import { slackTools } from '../slackTools.js'

const EXPECTED_TOOL_NAMES = [
  'slack_get_messages',
  'slack_post_message',
  'slack_list_channels',
  'slack_upload_file',
  'slack_download_file',
]

describe('slackTools', () => {
  it('returns an array of ToolPorts', () => {
    const tools = slackTools({ botToken: 'xoxb-test-token' })
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBe(5)
  })

  it('all tools are inline type', () => {
    const tools = slackTools({ botToken: 'xoxb-test-token' })
    for (const tool of tools) {
      expect(tool.type).toBe('inline')
    }
  })

  it('includes all expected tool names', () => {
    const tools = slackTools({ botToken: 'xoxb-test-token' })
    const names = tools.map((t) => t.name)
    for (const expected of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(expected)
    }
  })

  it('each tool has a description and handler', () => {
    const tools = slackTools({ botToken: 'xoxb-test-token' })
    for (const tool of tools) {
      expect(tool.type).toBe('inline')
      if (tool.type === 'inline') {
        expect(tool.inline.description).toBeTruthy()
        expect(typeof tool.inline.handler).toBe('function')
      }
    }
  })
})
