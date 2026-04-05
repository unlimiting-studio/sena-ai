# Project Setup Guide

> Korean version: [project-setup.ko.md](./project-setup.ko.md)

## Start with `sena init` (Recommended)

```bash
pnpm dlx @sena-ai/cli init my-bot
cd my-bot
```

The default template is `slack-integration`. To use another template:

```bash
pnpm dlx @sena-ai/cli init my-bot --template platform-integration
```

`sena init` automatically performs the following steps:
- Downloads the template with degit
- Replaces the `%%BOT_NAME%%` placeholder with the project name in `sena.config.ts`, `package.json`, and `slack-app-manifest.json`
- Converts `.env.template` into `.env`
- Runs `pnpm install`

### Register the Slack App

The generated `slack-app-manifest.json` already includes the bot name replacement. Use it to create the Slack app:

1. Go to https://api.slack.com/apps → **Create New App** → **From a manifest**
2. Choose the workspace
3. Paste the contents of `slack-app-manifest.json` into the JSON tab and create the app
4. In **Basic Information** → **App-Level Tokens**, create a token with the `connections:write` scope, then put the `xapp-` token into `SLACK_APP_TOKEN` in `.env`
5. In **OAuth & Permissions**, click **Install to Workspace**, then put the installed `xoxb-` bot token into `SLACK_BOT_TOKEN` in `.env`
6. Copy the App ID from **Basic Information** into `SLACK_APP_ID` in `.env`

The manifest already configures Socket Mode, the required scopes, and event subscriptions, so you do not need extra manual setup.

### Run

```bash
npx sena start
```

## Manual Setup (Without a Template)

You can also assemble the project manually:

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install @sena-ai/core @sena-ai/cli @sena-ai/runtime-claude
```

Install additional packages as needed:

```bash
npm install @sena-ai/slack     # Slack connector + tool bundle
npm install @sena-ai/hooks     # Built-in hooks (fileContext, traceLogger, currentTime)
```

## `.env` Setup

For Slack Socket Mode:

```env
SLACK_APP_ID=A0XXXXXXXXX
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-1-...
```

If you use HTTP Mode, use `SLACK_SIGNING_SECRET` instead of `SLACK_APP_TOKEN`.

## Minimal Config

```typescript
import { defineConfig } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'

export default defineConfig({
  name: 'my-agent',
  runtime: claudeRuntime({ model: 'claude-sonnet-4-6' }),
})
```

## Slack Connector

### HTTP Mode (Default)

Use this on a server with a public endpoint. Slack sends POST requests directly.

```typescript
import { slackConnector } from '@sena-ai/connector-slack'

slackConnector({
  appId: env('SLACK_APP_ID'),
  botToken: env('SLACK_BOT_TOKEN'),
  signingSecret: env('SLACK_SIGNING_SECRET'),
  // mode: 'http',  // optional because it is the default
  thinkingMessage: ':thinking: Thinking...',  // set false to disable
})
```

- Registers the `POST /api/slack/events` route
- Verifies HMAC-SHA256 signatures with five-minute replay protection

### Socket Mode

Use this behind a firewall or in local development. No public endpoint is required.

```typescript
slackConnector({
  appId: env('SLACK_APP_ID'),
  botToken: env('SLACK_BOT_TOKEN'),
  mode: 'socket',
  appToken: env('SLACK_APP_TOKEN'),  // xapp-… (App-Level Token)
  thinkingMessage: ':thinking: Thinking...',
})
```

**Create an App-Level Token:**
1. Go to https://api.slack.com/apps and select the app
2. Open Settings > Basic Information > App-Level Tokens
3. Create a token with the `connections:write` scope, then use the issued `xapp-` token

**Enable Socket Mode in the Slack app:**
1. Open Settings > Socket Mode and turn on **Enable Socket Mode**
2. Leave Event Subscriptions as-is, because the Request URL is ignored in Socket Mode

### Choosing the Mode

| | HTTP Mode | Socket Mode |
|---|---|---|
| Public endpoint | Required | Not required |
| Required key | `signingSecret` | `appToken` (`xapp-…`) |
| Behind a firewall | No | Yes |
| Recommended environment | Production | Local or firewalled servers |

### Type Definition

```typescript
type SlackConnectorOptions = {
  appId: string
  botToken: string
  thinkingMessage?: string | false
} & (
  | { mode?: 'http'; signingSecret: string; appToken?: never }
  | { mode: 'socket'; appToken: string; signingSecret?: never }
)
```

### Shared Behavior

- Handles `app_mention`, `message`, and `reaction_added` events while ignoring bot messages plus edits/deletes
- Responds immediately and processes the turn asynchronously
- Uses thread-based sessions: `conversationId = channelId:threadTs`
- The `stop()` lifecycle closes the WebSocket gracefully during drain in Socket Mode

## CLI

```bash
sena start              # run in the foreground
sena start -d           # daemon mode (logs are written to sena.log)
sena stop               # graceful shutdown (SIGTERM → wait 10s → SIGKILL)
sena restart            # zero-downtime worker replacement (SIGUSR2)
sena restart --full     # full process restart
sena status             # check PID + health endpoint
sena logs               # tail -f sena.log
```

`sena restart` sends SIGUSR2 to the orchestrator, starts a new worker, switches traffic after it is ready, and then drains the previous worker.

## Architecture

```text
Orchestrator (public port)
  └─ Worker (forked child process, internal random port)
       ├─ HTTP Server
       │    ├─ /health → 200 ok
       │    └─ Connector routes (e.g. /api/slack/events)
       ├─ TurnEngine
       │    ├─ [1] Auto-inject connector metadata
       │    ├─ [2] Run onTurnStart hooks → ContextFragment[]
       │    ├─ [3] Assemble context (system fragments first, then context)
       │    ├─ [4] Runtime.createStream() → stream events
       │    ├─ [5] Run onTurnEnd hooks (success) or onError hooks (failure)
       │    └─ Return TurnTrace
       ├─ Scheduler
       │    ├─ Heartbeat intervals (setInterval)
       │    └─ Cron polling (60s tick, Asia/Seoul timezone)
       └─ SessionStore (.sessions.json)
            └─ conversationId → sessionId mapping
```

### Turn Flow

1. A connector receives a message and calls `engine.submitTurn(event)`
2. Connector metadata is injected automatically through `[Current Message Context]`
3. `onTurnStart` hooks run in order and collect `ContextFragment[]`
4. All fragments are assembled into the system prompt
5. The runtime streams execution and handles tool calls plus results
6. **Steer** injects new messages from the same thread into the running turn at the next tool boundary
7. The result is sent back through the connector

### Session Management

- Maintains the mapping from `conversationId` (for example `channelId:threadTs`) to `sessionId`
- Uses file-based storage in `cwd/.sessions.json`, so it survives restarts
- Continues existing sessions through Claude SDK `resume`

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `EADDRINUSE` | Port conflict | Change `orchestrator.port` or stop the existing process |
| Slack 3s timeout error | The event handler is too slow | Usually not a problem because the connector returns HTTP 200 immediately; check the logs |
| A turn does not run | The session store file is corrupted | Delete `.sessions.json` and restart |
| Cron seems idle | Cron does not run immediately on startup | Cron only runs on matching expressions; use heartbeat if you need an immediate run |
| `env()` error | Missing `.env` file or missing keys | Check the `.env` file |
