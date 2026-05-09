# Tools (MCP & Inline)

## 한 줄

**MCP 서버를 1급으로 붙일 수 있다.** Zod 인라인 도구는 chat-sdk · ai-sdk 자체 메커니즘으로 흡수 시도 → 안 되면 MCP 서버 우회.

## MCP 서버 등록

`config.mcpServers`에 1급으로 등록. provider(`claudeCode`/`codexCli`)에 그대로 전달된다.

```ts
mcpServers: {
  fs: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/dir'],
  },
  github: {
    type: 'streamable-http',
    url: 'http://localhost:3000/mcp',
  },
}
```

지원 transport (가설):
- `stdio` (subprocess + JSON-RPC)
- `streamable-http` (HTTP/SSE)

> 정확한 키 이름과 옵션은 두 provider의 mcpServers 시그니처를 1차 마이그에서 검증.

## Inline tool (Zod) — 우회 전략

**문제:** `ai-sdk-provider-claude-code`는 AI SDK 커스텀 tool(Zod 스키마)을 지원하지 않는다. `ai-sdk-provider-codex-cli`도 동일.

**1차 가설:** chat-sdk가 자체 tool 메커니즘을 LLM에 노출하면 그걸 사용. 흡수 안 되면 다음 우회.

**우회 — 인라인 MCP 서버:**
v2의 `inline-mcp-bridge.ts` 패턴 재활용. 한 에이전트 프로세스 안에 localhost MCP 서버를 1개 띄우고, 우리 inline 도구들을 그 서버의 tool로 등록한다. provider mcpServers 설정에 `streamable-http`로 추가.

```ts
// 가설
import { defineTool } from '@unlimiting-studio/sena/tools';
import { z } from 'zod';

const slackPostMessage = defineTool({
  name: 'slack_post_message',
  description: '...',
  parameters: z.object({ channel: z.string(), text: z.string() }),
  execute: async ({ channel, text }) => { /* ... */ },
});

// sena.config.ts
mcpServers: {
  ...inlineToolsAsMcp([slackPostMessage, ...]),  // 자동으로 localhost MCP 띄움
}
```

## v2 vs v3

| 영역                          | v2                                       | v3                                                |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------- |
| MCP 서버 등록                  | `runtime-claude`가 직접 관리              | provider mcpServers 옵션 (1급)                     |
| `__native__` 컨벤션           | 우리 임시 명명 (PRD에서 폐기)             | 사용 안 함                                        |
| inline tool (Zod)              | `defineTool()` 1급                       | chat-sdk·ai-sdk 흡수 시도 → 안 되면 inline MCP 우회  |
| MCP transport 자동 reset      | `inline-mcp-bridge.ts` 자체 구현          | provider 동작 우선. 부족하면 wrapper로 보강         |

## 검증 필요

- 두 provider의 정확한 mcpServers 시그니처 (transport 종류, 환경변수 전달, timeout).
- chat-sdk가 ai-sdk LanguageModel 호출 시 `tools` 옵션을 어떻게 전달하는지. claude-code provider가 그 tools 옵션을 무시하는지 / 일부만 받는지.
- inline MCP 서버를 한 프로세스 안에 띄울 때 포트 충돌 / lifecycle 정리 — v2 `inline-mcp-bridge` 노하우 그대로 차용 가능.

## AC

1. PoC 에이전트가 외부 MCP 서버(예: `@modelcontextprotocol/server-filesystem`)를 등록하고 한 turn 안에서 도구 호출 가능.
2. 우리 inline 도구 1개(예: `slack_post_message`)를 inline MCP 우회로 등록해서 호출 가능.
3. MCP transport 단절(`Stream closed` 또는 동등)이 발생해도 같은 turn 안에서 1회 자동 재시도된다 (provider 자체 동작 또는 우리 wrapper).
