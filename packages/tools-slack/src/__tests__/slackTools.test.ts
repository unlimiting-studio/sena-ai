import { describe, it, expect } from 'vitest'
import { slackTools } from '../slackTools.js'

describe('slackTools', () => {
  it('creates a ToolPort with correct name and type', () => {
    const tool = slackTools({ botToken: 'xoxb-test-token' })

    expect(tool.name).toBe('slack')
    expect(tool.type).toBe('mcp-stdio')
  })

  it('generates MCP config with token in env', () => {
    const tool = slackTools({ botToken: 'xoxb-test-token' })
    const config = tool.toMcpConfig({ name: 'claude' }) as any

    expect(config.command).toBe('node')
    expect(config.env.SLACK_BOT_TOKEN).toBe('xoxb-test-token')
  })
})
