# Sena AI
A config-driven AI agent framework monorepo. Compose runtimes, connectors, tools, hooks, schedules, and the orchestrator in a single `sena.config.ts`, then use the `sena` CLI for local operations and template bootstrapping.

## Key Features

- Config-driven agent composition with `defineConfig()`
- Swappable runtimes such as `@sena-ai/runtime-claude` and `@sena-ai/runtime-codex`
- Support for both direct Slack integration and platform relay integration
- Inline tools, MCP tools, and bundled Slack tools
- A CLI with `start`, `stop`, `restart`, `status`, `logs`, and `init`
- Worker-based execution, rolling restart, session persistence, and schedules
- Spec-first development with a `specs/` directory in every package

## Requirements

- Node.js `>= 22`
- `pnpm`
- An ESM-based TypeScript runtime environment

## Quick Start

### Create a New Project from a Template

The default template is direct Slack integration.

```bash
pnpm dlx @sena-ai/cli init my-bot
cd my-bot
```

Use `--template` if you want a different template.

```bash
pnpm dlx @sena-ai/cli init my-bot --template slack-integration
pnpm dlx @sena-ai/cli init my-bot --template platform-integration
```

`sena init` automatically performs the following steps.

- Downloads the template
- Replaces the `%%BOT_NAME%%` placeholder in `sena.config.ts`, `package.json`, and `slack-app-manifest.json`
- Renames `.env.template` to `.env`
- Runs `pnpm install`

For the Slack template, you can create the app at https://api.slack.com/apps with the generated `slack-app-manifest.json`, and the scopes plus event subscriptions are configured automatically. After that, fill in the credentials in `.env` and run the agent.

```bash
npx sena start
```

The default config file path is `sena.config.ts`, and the default port is `3100`. The CLI automatically loads `.env` from the current working directory when it starts.

### Slack Template Example

The `slack-integration` template is generated in Socket Mode. It does not require a public endpoint, so it can run locally or behind a firewall without extra setup.

```ts
import { defineConfig, env, cronSchedule, heartbeat } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector, slackTools } from '@sena-ai/slack'
import { fileContextHook, currentTimeHook } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-bot',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-6',
  }),

  connectors: [
    slackConnector({
      mode: 'socket',
      appId: env('SLACK_APP_ID'),
      appToken: env('SLACK_APP_TOKEN'),
      botToken: env('SLACK_BOT_TOKEN'),
    }),
  ],

  tools: [...slackTools({ botToken: env('SLACK_BOT_TOKEN') })],

  hooks: {
    onTurnStart: [
      fileContextHook({ as: 'system', path: 'prompts/SYSTEM.md' }),
      currentTimeHook({ timezone: 'Asia/Seoul' }),
    ],
  },

  schedules: [
    heartbeat('30m', { name: 'channel-watch', prompt: 'Check the channel and summarize what matters.' }),
  ],
})
```

Required environment variables:

```env
SLACK_APP_ID=
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
```

> To use HTTP Mode, replace `mode: 'socket'` and `appToken` with `signingSecret`.

### Platform Relay Template Example

The `platform-integration` template routes Slack traffic through the platform instead of storing Slack tokens in the local runtime.

```ts
import { defineConfig, env } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { platformConnector } from '@sena-ai/platform-connector'

export default defineConfig({
  name: 'my-bot',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-20250514',
  }),

  connectors: [
    platformConnector({
      platformUrl: env('PLATFORM_URL'),
      connectKey: env('CONNECT_KEY'),
    }),
  ],
})
```

Required environment variables:

```env
CONNECT_KEY=
PLATFORM_URL=
```

## Build It Directly from Libraries

You can also assemble exactly the packages you want without using a template.

```bash
pnpm add @sena-ai/core @sena-ai/hooks @sena-ai/tools @sena-ai/runtime-claude
```

If you need direct Slack integration, add the convenience bundle `@sena-ai/slack`.

```bash
pnpm add @sena-ai/cli @sena-ai/slack
```

A minimal example looks like this.

```ts
import { createAgent, defineConfig, defineTool, heartbeat } from '@sena-ai/core'
import { fileContextHook, traceLoggerHook } from '@sena-ai/hooks'
import { mcpServer } from '@sena-ai/tools'
import { claudeRuntime } from '@sena-ai/runtime-claude'

const config = defineConfig({
  name: 'demo-agent',
  runtime: claudeRuntime({
    model: 'claude-sonnet-4-6',
  }),
  tools: [
    defineTool({
      name: 'ping',
      description: 'Return pong',
      handler: async () => 'pong',
    }),
    mcpServer({
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    }),
  ],
  hooks: {
    onTurnStart: [
      fileContextHook({ path: './AGENTS.md', as: 'system' }),
    ],
    onTurnEnd: [
      traceLoggerHook({ dir: './traces' }),
    ],
  },
  schedules: [
    heartbeat('1h', { name: 'heartbeat', prompt: 'Check the current state and summarize it.' }),
  ],
})

const agent = createAgent(config)
const trace = await agent.processTurn({ input: 'Summarize the current state.' })

console.log(trace.result?.text)
```

## CLI

| Command | Description |
| --- | --- |
| `sena init <name>` | Creates a new project, including template download, placeholder replacement, and dependency installation |
| `sena start` | Starts the orchestrator in the foreground |
| `sena start -d` | Starts in background daemon mode and writes logs to `sena.log` |
| `sena stop` | Sends `SIGTERM` to the running process, and `SIGKILL` if needed |
| `sena restart` | Performs a rolling restart of the worker |
| `sena restart --full` | Restarts the entire process |
| `sena status` | Checks the PID and `/health` status |
| `sena logs` | Shows `sena.log` |

The CLI uses `.sena.pid` and `sena.log` in the current working directory.

## Architecture

```text
Connector / Schedule / Programmatic Call
  -> TurnEngine
     -> onTurnStart hooks
     -> Runtime.createStream()
        -> inline tools / MCP tools
     -> onTurnEnd / onError hooks
  -> Connector output

Orchestrator
  -> Worker child process
     -> HTTP server
     -> Session store
     -> Scheduler
     -> Pending message queue
```

The core behavior works like this.

- Concurrent inputs for the same conversation are queued by the worker to preserve ordering.
- The worker can inject pending messages through steer at tool boundaries.
- The session store keeps the `conversationId -> sessionId` mapping.
- The orchestrator only switches traffic after the new worker is ready.
- Schedules are defined with `cronSchedule()` and `heartbeat()`, and duplicate runs of the same schedule are prevented.

## Package Overview

| Package | Role |
| --- | --- |
| `@sena-ai/core` | Config normalization, turn engine, worker, orchestrator, scheduler, and tool contracts |
| `@sena-ai/hooks` | Built-in hooks such as `fileContext` and `traceLogger` |
| `@sena-ai/tools` | `mcpServer()` for connecting external MCP servers |
| `@sena-ai/cli` | CLI for project initialization and agent operations |
| `@sena-ai/runtime-claude` | Runtime built on Claude Agent SDK |
| `@sena-ai/runtime-codex` | Runtime built on the Codex CLI App Server |
| `@sena-ai/slack-mrkdwn` | Shared package for Slack safe-mode Markdown conversion |
| `@sena-ai/connector-slack` | Slack Events API / Socket Mode connector |
| `@sena-ai/tools-slack` | Slack tools for messages, channels, files, and users |
| `@sena-ai/slack` | Bundle of the Slack connector and Slack tools |
| `@sena-ai/platform-connector` | Local runtime connection through the platform relay |
| `@sena-ai/platform-core` | Multi-tenant platform core library |
| `@sena-ai/platform-node` | Node.js platform server entry point with MySQL composition |
| `@sena-ai/platform-worker` | Cloudflare Workers-based platform deployment package |

`@sena-ai/platform-node` and `@sena-ai/platform-worker` are currently operated as application deployment packages rather than general-purpose library packages.

## Runtimes and Tools

### Runtimes

- `@sena-ai/runtime-claude`
  - Wraps Claude Agent SDK around the Sena `Runtime` contract.
  - Supports inline tools and external MCP tools together.
  - Supports session resume, steer, and abort flows.
- `@sena-ai/runtime-codex`
  - Connects the Codex CLI App Server to the Sena `Runtime` contract.
  - Configures an inline MCP HTTP server plus MCP server overrides.
  - Provides approval policy, sandbox mode, and reasoning effort options.
  - Uses the managed executable from the official `@openai/codex` package by default, and only overrides it with `codexBin` when needed.

### Tools

- Define inline tools with `defineTool()`.
- Connect external MCP tools with `mcpServer()`.
- If your agent does a lot of Slack work, use `slackTools()` or the `@sena-ai/slack` bundle.
- Tool results can return multimodal content with `toolResult()`.

## Spec-first Development

Every package in this repository has its own `specs/` directory.

```text
packages/<package>/specs/
  index.md
  <responsibility>.md
```

The rules are simple.

- Update the spec first when changing behavior.
- Maintain traceability between the top-level `index.md` and the detailed specs.
- Implement against frozen specs.

Representative examples:

- `packages/core/specs/`
- `packages/cli/specs/`
- `packages/runtime/claude/specs/`
- `packages/runtime/codex/specs/`
- `packages/integrations/slack/connector/specs/`
- `packages/platform/core/specs/`

## Repository Structure

```text
sena-ai/
├── packages/
│   ├── cli/
│   ├── core/
│   ├── hooks/
│   ├── tools/
│   ├── runtime/
│   │   ├── claude/
│   │   └── codex/
│   ├── integrations/
│   │   └── slack/
│   │       ├── bundle/
│   │       ├── connector/
│   │       └── tools/
│   └── platform/
│       ├── connector/
│       ├── core/
│       ├── runtime-node/
│       └── runtime-worker/
├── templates/
│   ├── platform-integration/
│   └── slack-integration/
├── package.json
├── pnpm-workspace.yaml
└── vitest.config.ts
```

## Development

```bash
git clone https://github.com/unlimiting-studio/sena-ai
cd sena-ai
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Tests run against the `packages/**/src/**/*.test.ts` pattern.
