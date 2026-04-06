# Writing and Managing `sena.config.ts`


This is the entry point for all agent configuration. Declare it with `defineConfig()`.

## Full Config Example

```typescript
import { defineConfig, env, heartbeat, cronSchedule } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector } from '@sena-ai/connector-slack'
import { slackTools } from '@sena-ai/tools-slack'
import { fileContext } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-agent',
  cwd: './context/',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-6',
    maxTurns: 100,
    permissionMode: 'bypassPermissions',
  }),

  connectors: [
    slackConnector({
      appId: env('SLACK_APP_ID'),
      botToken: env('SLACK_BOT_TOKEN'),
      signingSecret: env('SLACK_SIGNING_SECRET'),
      thinkingMessage: ':thinking: Thinking...',
    }),
  ],

  tools: [
    ...slackTools({ botToken: env('SLACK_BOT_TOKEN') }),
  ],

  hooks: {
    onTurnStart: [
      fileContext({ path: './context/SYSTEM.md', as: 'system' }),
      fileContext({ path: './context/memory/', as: 'context', glob: '*.md' }),
    ],
  },

  schedules: [
    heartbeat('1h', {
      name: 'heartbeat',
      prompt: 'Check the system status.',
    }),
    cronSchedule('0 9 * * 1-5', {
      name: 'morning-briefing',
      prompt: 'Summarize today\'s schedule.',
    }),
  ],

  orchestrator: { port: 3100 },
})
```

## Config Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Y | Agent name |
| `cwd` | `string` | | Working directory for file reads and writes |
| `runtime` | `Runtime` | Y | LLM runtime |
| `connectors` | `Connector[]` | | Input/output channels |
| `tools` | `ToolPort[]` | | Tools available to the agent |
| `hooks` | `object` | | Lifecycle hooks |
| `schedules` | `Schedule[]` | | Cron jobs and heartbeats |
| `orchestrator` | `{ port?: number }` | | Orchestrator port (default: 3100) |

## `env()` — Environment Variables

Use `env(key, default?)` to reference environment variables safely.

```typescript
import { env, validateEnv } from '@sena-ai/core'

const token = env('SLACK_BOT_TOKEN')           // required
const port = env('PORT', '3100')               // has a default value

validateEnv()  // throws if required env vars are missing (usually unnecessary to call directly; defineConfig handles it)
```

## Runtime

### Claude Runtime

```typescript
import { claudeRuntime, DEFAULT_ALLOWED_TOOLS } from '@sena-ai/runtime-claude'

claudeRuntime({
  model?: string,             // default: 'claude-sonnet-4-5'
  apiKey?: string,            // default: ANTHROPIC_API_KEY environment variable
  maxTurns?: number,          // default: 100
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk',  // default: 'dontAsk'
  allowedTools?: string[],    // tools auto-approved in dontAsk mode (default: DEFAULT_ALLOWED_TOOLS)
  disallowedTools?: string[], // tool patterns always blocked (merged with per-turn disabledTools)
})
```

- Uses Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- Internally converts inline tools into an in-process MCP server (`__native__`)

### `permissionMode`

| Mode | Behavior |
|---|---|
| `default` | Shows terminal prompts for risky actions; cannot be used in non-interactive environments |
| `acceptEdits` | Auto-approves file edits, but still prompts for the rest |
| **`dontAsk`** | **Default.** No prompts. Any tool not in `allowedTools` is automatically rejected |
| `bypassPermissions` | Skips everything. Existing agents must opt into this explicitly to preserve old behavior |
| `plan` | Produces a plan only and does not execute tools |

### `DEFAULT_ALLOWED_TOOLS`

If you do not specify `allowedTools` in `dontAsk` mode, this preset is applied automatically.

```typescript
import { DEFAULT_ALLOWED_TOOLS } from '@sena-ai/runtime-claude'

// DEFAULT_ALLOWED_TOOLS contains:
// File operations: Read, Write, Edit, MultiEdit
// Search & navigation: Glob, Grep, LS
// Execution: Bash
// Notebooks: NotebookRead, NotebookEdit
// Agent & planning: Agent, ToolSearch
```

If you need extra tools such as Slack tools, merge them into `allowedTools`.

```typescript
import { DEFAULT_ALLOWED_TOOLS } from '@sena-ai/runtime-claude'
import { ALLOWED_SLACK_TOOLS } from '@sena-ai/tools-slack'

claudeRuntime({
  permissionMode: 'dontAsk',
  allowedTools: [...DEFAULT_ALLOWED_TOOLS, ...ALLOWED_SLACK_TOOLS],
})
```

Tools registered through MCP server config in `tools` are allowed automatically, so you do not need to add them separately.

## Hooks — Lifecycle Hooks

Hooks are functions that run at different stages of a turn. There are three timing points.

### `onTurnStart` — Context Injection

Runs before a turn starts. Returns `ContextFragment[]`, which is injected into the system prompt.

```typescript
type TurnStartHook = {
  name: string
  execute(context: TurnContext): Promise<ContextFragment[]>
}

type ContextFragment = {
  source: string                // display label (e.g. 'file:AGENTS.md')
  role: 'system' | 'context'    // system: system prompt, context: supporting reference
  content: string
}
```

- `system`: behavior rules, identity, and other material placed at the front of the system prompt
- `context`: reference information and memory placed after the system fragments

### `onTurnEnd` — Post-processing

Runs after a turn completes successfully. Use it for logging or persistence.

```typescript
type TurnEndHook = {
  name: string
  execute(context: TurnContext, result: TurnResult): Promise<void>
}
```

### `onError` — Error Handling

Runs when a runtime error occurs. Use it for logging or alerts.

```typescript
type ErrorHook = {
  name: string
  execute(context: TurnContext, error: Error): Promise<void>
}
```

### Built-in Hook: `fileContext`

```typescript
import { fileContext } from '@sena-ai/hooks'

fileContext({
  path: string,          // file path or directory path
  as: 'system' | 'context',
  glob?: string,         // file filter when path is a directory (e.g. '*.md')
  when?: (ctx: TurnContext) => boolean,  // conditional execution
  maxLength?: number,    // content length limit
})
```

```typescript
// Single file
fileContext({ path: './AGENTS.md', as: 'system' })

// Specific pattern inside a directory
fileContext({ path: './memory/', as: 'context', glob: '*.md' })

// Conditional usage (only for the Slack connector)
fileContext({
  path: './slack-guide.md',
  as: 'system',
  when: (ctx) => ctx.connector?.name === 'slack',
})
```

### Built-in Hook: `traceLogger`

```typescript
import { traceLogger } from '@sena-ai/hooks'

hooks: {
  onTurnEnd: [
    traceLogger({ dir: './traces/' }),  // creates {turnId}-{timestamp}.json files
  ],
}
```

### Writing a Custom Hook

```typescript
import type { TurnStartHook, TurnContext, ContextFragment } from '@sena-ai/core'

const myHook: TurnStartHook = {
  name: 'my-hook',
  async execute(context: TurnContext): Promise<ContextFragment[]> {
    // context.trigger: 'connector' | 'schedule' | 'programmatic'
    // context.connector?: { name, conversationId, userId, userName }
    // context.schedule?: { name, type: 'cron' | 'heartbeat' }

    if (context.trigger !== 'connector') return []

    const data = await fetchSomeData(context.connector!.userId)
    return [{
      source: 'my-hook',
      role: 'context',
      content: `User preferences: ${JSON.stringify(data)}`,
    }]
  },
}
```

## Schedules — Cron Jobs and Heartbeats

Schedules let the agent run autonomously without external input.

### Heartbeat — Fixed Interval Execution

```typescript
import { heartbeat } from '@sena-ai/core'

heartbeat(interval: string, options: {
  name?: string,
  prompt: string,
})
```

- `interval` format: `'30s'`, `'15m'`, `'1h'`
- Runs **immediately once when the agent starts**, then repeats on the interval
- Prevents overlapping execution: if the previous turn is still running, the next one is skipped

```typescript
heartbeat('1h', {
  name: 'health-check',
  prompt: 'Check the system status.',
})
```

### Cron — Exact Time-based Execution

```typescript
import { cronSchedule } from '@sena-ai/core'

cronSchedule(expression: string, options: {
  name: string,
  prompt: string,
})
```

- `expression`: five-field cron format (`minute hour day month weekday`)
- Timezone: `Asia/Seoul` (currently hardcoded)
- Supported syntax: `*`, `*/n` (step), `n-m` (range), `n,m,...` (list)
- Does not run on startup; it runs only when the current time matches the cron expression

```typescript
// Every weekday at 9:00 AM
cronSchedule('0 9 * * 1-5', {
  name: 'morning-briefing',
  prompt: 'Prepare today\'s schedule and share it in Slack.',
})

// Every 30 minutes (:13 and :43)
cronSchedule('13,43 * * * *', {
  name: 'email-check',
  prompt: 'Check unread email.',
})
```

### Choosing Between Heartbeat and Cron

| | Heartbeat | Cron |
|---|---|---|
| Time precision | Relative to startup time | Absolute time |
| Runs immediately on startup | Y | N |
| Typical use cases | Health checks, memory cleanup | Schedule reminders, recurring reports |

## `TurnContext` Reference

```typescript
type TurnContext = {
  turnId: string              // UUID
  agentName: string           // name from defineConfig
  trigger: 'connector' | 'schedule' | 'programmatic'
  input: string               // user message or schedule prompt
  connector?: {
    name: string              // connector name (e.g. 'slack')
    conversationId: string    // e.g. 'C0AFW5Y133J:1234567890.123456'
    userId: string
    userName: string
    files?: FileAttachment[]
    raw: unknown              // raw event payload
    disabledTools?: string[]  // tools disabled for this turn
  }
  schedule?: {
    name: string              // schedule name
    type: 'cron' | 'heartbeat'
  }
  sessionId: string | null
  metadata: Record<string, unknown>
}
```

## Common Patterns

### File-based Agent Persona

```typescript
hooks: {
  onTurnStart: [
    fileContext({ path: './persona/IDENTITY.md', as: 'system' }),
    fileContext({ path: './persona/RULES.md', as: 'system' }),
    fileContext({ path: './persona/MEMORY.md', as: 'context' }),
  ],
}
```

### Channel-specific Context Injection (Custom Hook)

```typescript
const channelHook: TurnStartHook = {
  name: 'channel-context',
  async execute(ctx) {
    if (ctx.trigger !== 'connector') return []
    const channelId = ctx.connector!.conversationId.split(':')[0]
    const config = JSON.parse(await readFile('./channels.json', 'utf-8'))
    const channel = config[channelId]
    if (!channel) return []
    return [{
      source: `channel:${channelId}`,
      role: 'context',
      content: `Channel: #${channel.name}\nDescription: ${channel.description}`,
    }]
  },
}
```

### Inject Only Today and Yesterday Memory

```typescript
function recentMemoryGlob(): string {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  return `{${yesterday},${today}}.md`
}

fileContext({ path: './memory/', as: 'context', glob: recentMemoryGlob() })
```
