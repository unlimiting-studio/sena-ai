---
name: sena-ai
description: Use this skill when building or modifying an AI agent with the @sena-ai framework. It covers new-project setup, Slack connectors (HTTP/Socket Mode), writing sena.config.ts (runtime, hooks, schedules), defining custom tools, connecting MCP servers, and operating the CLI.
---
# sena-ai Agent Framework

`@sena-ai` is a config-driven AI agent framework. Define runtimes, connectors, tools, hooks, and schedules in a single `sena.config.ts`, then operate everything through a zero-downtime CLI.

This skill is split into three parts. Open the file that best matches what you need.

- **[`project-setup.md`](./project-setup.md)** - New project initialization, Slack connectors (HTTP/Socket Mode), `.env` setup, CLI commands, architecture, and troubleshooting
- **[`config-guide.md`](./config-guide.md)** - `sena.config.ts` field reference, `env()`, runtimes (`permissionMode`, `allowedTools`), lifecycle hooks (`fileContext`, `traceLogger`, and custom hooks), cron/heartbeat schedules, `TurnContext`, and common patterns
- **[`tools-and-mcp.md`](./tools-and-mcp.md)** - Inline tools with `defineTool`, built-in `slackTools`, MCP servers (HTTP/stdio), per-turn tool limits with `disabledTools`, and tool control inside custom connectors
