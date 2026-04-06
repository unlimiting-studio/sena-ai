# Defining Custom Tools and Connecting MCP
## Inline Tools (`defineTool`)

```typescript
import { defineTool, toolResult } from '@sena-ai/core'
import { z } from 'zod'

const weatherTool = defineTool({
  name: 'get_weather',
  description: 'Look up the current weather for a city',
  params: {
    city: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius'),
  },
  handler: async ({ city, unit }) => {
    const data = await fetchWeather(city, unit)
    return `${city}: ${data.temp}°${unit === 'celsius' ? 'C' : 'F'}`
  },
})
```

### Return Types

| Return value | Handling |
|---|---|
| `string` | Sent as text content |
| `object` | Sent as text after `JSON.stringify()` |
| `toolResult([...])` | Multi-content output such as text + image |

### Returning Multi-content Output (Including Images)

```typescript
import { defineTool, toolResult } from '@sena-ai/core'

const screenshotTool = defineTool({
  name: 'take_screenshot',
  description: 'Capture a screenshot',
  handler: async () => {
    const imageData = await captureScreen()
    return toolResult([
      { type: 'text', text: 'Screenshot captured' },
      { type: 'image', data: imageData, mimeType: 'image/png' },
    ])
  },
})
```

## Slack Tools

```typescript
import { slackTools, ALLOWED_SLACK_TOOLS } from '@sena-ai/tools-slack'

// Register all 6 tools at once
const tools = slackTools({ botToken: env('SLACK_BOT_TOKEN') })
```

Use `ALLOWED_SLACK_TOOLS` when you want to add Slack tools to the allowlist in `dontAsk` mode.

```typescript
claudeRuntime({
  allowedTools: [...DEFAULT_ALLOWED_TOOLS, ...ALLOWED_SLACK_TOOLS],
})
```

| Tool | Description |
|---|---|
| `slack_get_messages` | Read channel history or thread replies |
| `slack_post_message` | Send a message to a channel or thread |
| `slack_list_channels` | List accessible channels |
| `slack_upload_file` | Upload text content as a file |
| `slack_get_users` | Read user profiles |
| `slack_download_file` | Download a file, with images returned as base64 |

## Connecting MCP Servers

You can register external MCP servers as tools.

### HTTP-based MCP

```typescript
const mcpHttpTool: McpToolPort = {
  name: 'my-mcp-server',
  type: 'mcp-http',
  toMcpConfig: () => ({ url: 'http://localhost:8080/mcp' }),
}
```

### stdio-based MCP

```typescript
const mcpStdioTool: McpToolPort = {
  name: 'filesystem',
  type: 'mcp-stdio',
  toMcpConfig: () => ({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  }),
}
```

### Register It in Config

```typescript
export default defineConfig({
  tools: [mcpHttpTool, mcpStdioTool, ...slackTools({ botToken })],
  // ...
})
```

Tools registered through MCP server config are automatically allowed in `dontAsk` mode, so you do not need to add them to `allowedTools`.

## `disabledTools` — Disable Tools Per Turn

If a connector sets `disabledTools` on `InboundEvent`, it can disable specific tools for that turn using a blocklist approach.

```typescript
engine.submitTurn({
  connector: 'my-platform',
  conversationId: '...',
  userId: '...',
  userName: '...',
  text: '...',
  raw: {},
  disabledTools: ['Bash', 'Write', 'Edit'],
})
```

### How It Works (Two-stage Filtering)

1. **Engine level**: removes `ToolPort`s whose names exactly match entries in `disabledTools`. Use this when you want to remove an entire MCP server or inline tool.
2. **Runtime level**: passes the full `disabledTools` pattern list into the runtime. Each runtime applies it in its own way.
   - **Claude**: merges the list into the SDK's `disallowedTools`. Wildcard patterns such as `mcp__server__*`, individual tool names, and built-in tools like `Read` or `Bash` are all supported.

### Pattern Examples

```typescript
disabledTools: [
  'Bash',                    // Claude built-in tool
  'Write',                   // Claude built-in tool
  'mcp__slack-tools__*',     // wildcard for every tool in one MCP server
  'mcp____native____my_tool', // one specific inline tool
  'my-mcp-server',           // remove the entire MCP server by ToolPort name
]
```

### Example — Restrict Tools by Condition

```typescript
registerRoutes(server, engine) {
  server.post('/api/webhook', async (req, res) => {
    const event = parseEvent(req)

    // If triggered by an emoji reaction, allow only read-only tools
    const isEmojiTrigger = event.type === 'reaction_added'

    await engine.submitTurn({
      connector: 'my-platform',
      conversationId: event.channelId,
      userId: event.userId,
      userName: event.userName,
      text: event.text,
      raw: event,
      disabledTools: isEmojiTrigger
        ? ['Bash', 'Write', 'Edit', 'NotebookEdit']
        : undefined,
    })
  })
}
```

## Tool Control Inside a Custom Connector

```typescript
import type { Connector, HttpServer, TurnEngine, ConnectorOutput } from '@sena-ai/core'

const myConnector: Connector = {
  name: 'my-platform',

  registerRoutes(server: HttpServer, engine: TurnEngine) {
    server.post('/api/my-platform/webhook', async (req, res) => {
      // 1. Parse and validate the request
      // 2. Call engine.submitTurn(inboundEvent)
      // 3. Return an immediate response
    })
  },

  createOutput(context) {
    return {
      async showProgress(text) { /* show progress state */ },
      async sendResult(text) { /* send the final result */ },
      async sendError(message) { /* send an error message */ },
      async dispose() { /* cleanup work */ },
    }
  },
}
```
