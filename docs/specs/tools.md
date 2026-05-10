# Tools (MCP & Inline)

**상태:** rev. 3 (step 4.6 cbc0208 — `config.tools` (ai-sdk native ToolSet) + `maxSteps` + `stopWhen` 반영. 인라인 MCP 우회 결정은 그대로 유지).

## 한 줄

**ai-sdk native ToolSet 경로가 1급으로 코드에 박혀있다** (`config.tools`, `maxSteps`, `stopWhen: stepCountIs`). MCP 서버 등록은 SPEC 으로는 1급(`config.mcpServers`) 이지만 step 4.x 까지는 `run()` 진입 시 fail-fast — provider 옵션 병합이 step 5+ 로 미뤄짐. **Zod 인라인 도구는 provider(claude-code / codex-cli) 둘 다 미지원 → 인라인 MCP 우회로 확정** (PoC 0 단계, 차니 결정).

## ai-sdk native ToolSet — `config.tools`

step 4.6 cbc0208 에서 `streamText` 호출 4 곳 모두에 `tools: deps.tools` + `stopWhen: deps.tools ? stepCountIs(deps.maxSteps) : undefined` 가 박혔다. 인라인 MCP 우회 결정과 *별개 경로* 로, 사용자가 ai-sdk 의 표준 `ToolSet` (예: `tool({ description, inputSchema, execute })`) 을 그대로 `config.tools` 에 박으면 모델이 직접 호출하는 도구가 된다.

### 적용 위치

| 호출 위치                                              | 코드                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/app/src/runtime/handlers/queue.ts`          | `streamText({ model, tools: deps.tools, stopWhen: ... })`           |
| `packages/app/src/runtime/handlers/steering.ts`       | `streamText({ model, tools: deps.tools, stopWhen: ..., abortSignal })` |
| `packages/app/src/runtime/handlers/step.ts`           | `streamText({ model, tools: deps.tools, stopWhen: ..., abortSignal })` |
| `packages/app/src/runtime/scheduleFanOut.ts`          | `streamText({ model, tools: deps.tools, stopWhen: ... })` (cron turn)  |

즉 mention / subscribed-message / step-steering / cron 4 트리거 모두에서 같은 ToolSet · `maxSteps` 가 적용된다.

### `stopWhen` 종료 조건

```ts
streamText({
  model,
  tools: deps.tools,
  stopWhen: deps.tools ? stepCountIs(deps.maxSteps) : undefined,
  prompt,
  abortSignal,  // steering / step-steering / queue 핸들러는 미적용
});
```

- `tools` 가 `undefined` 면 `stopWhen` 도 `undefined` — ai-sdk 의 단일-step (텍스트만) 폴백.
- `tools` 가 있으면 `stepCountIs(maxSteps)` 로 tool loop step 상한을 강제. `maxSteps` 는 `config.maxSteps ?? 5` (런타임 폴백).

### `HandlerDeps` (코드 기준)

```ts
export interface HandlerDeps {
  model: LanguageModelV3;     // wrapLanguageModel 적용된 후 (middleware 체인 포함)
  tools?: ToolSet;
  maxSteps: number;
  drain: DrainController;
  steering: SteeringRegistry;
  log: (message: string) => void;
}
```

`run()` 에서 `{ ..., maxSteps: config.maxSteps ?? 5 }` 로 주입. `scheduleFanOut` 도 같은 `tools` / `maxSteps ?? 5` 를 받아 cron turn 에 그대로 적용한다.

### 트레이드오프

`tools` 가 박힌 turn 은 ai-sdk 가 모델에 tool 정의를 함께 보낸다. 그러나 `ai-sdk-provider-claude-code` / `-codex-cli` 는 ai-sdk 의 Zod 스키마 도구를 *모델로 흘려보내지 않는* 것이 PoC 에서 확인됨 (provider 가 무시하거나 일부만 받음 — `docs/specs/hooks.md` 검증 결과 참조). 따라서 두 provider 환경에서는 `config.tools` 가 실제로는 동작하지 않을 가능성이 높다 — 그래도 코드 경로 자체는 ai-sdk-native 라 다른 provider(예: `@ai-sdk/openai`) 에서는 그대로 동작한다. 두 provider 환경에서 **실제 사용자 도구를 LLM 에 노출하는 본 경로는 인라인 MCP 우회 (아래 절)** 다.

## MCP 서버 등록 (`config.mcpServers`)

`config.mcpServers` 에 1급으로 등록. provider(`claudeCode`/`codexCli`) 에 그대로 전달된다 (가설).

```ts
mcpServers: {
  fs: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/dir'],
  },
}
```

**현 상태 (step 4.x):** `run()` 진입 시 `config.mcpServers` 가 들어있으면 *fail-fast throw*. silent 무시는 운영자가 "도구가 안 붙는 이유" 를 찾기 어렵게 만들기 때문. step 4+ 에서 provider 옵션 병합이 닫힌다.

지원 transport (SPEC 가설):
- `stdio` (subprocess + JSON-RPC)
- `streamable-http` (HTTP/SSE)

> 정확한 키 이름과 옵션은 두 provider 의 `mcpServers` 시그니처를 step 5+ 마이그에서 검증.

## Inline tool (Zod) — 우회 전략 ✅ 확정

**문제:** `ai-sdk-provider-claude-code` 는 AI SDK 커스텀 tool(Zod 스키마) 을 *모델 입장에서 사용 가능한 도구로* 노출하지 않는다. `ai-sdk-provider-codex-cli` 도 동일. chat-sdk 도 자체 tool 메커니즘을 LLM 에 노출하지 않음.

**해결: 인라인 MCP 서버 우회.** (차니 결정, PoC 0 단계, 2026-05-10)

**우회 — 인라인 MCP 서버:**
v2 의 `inline-mcp-bridge.ts` 패턴 재활용. 한 에이전트 프로세스 안에 localhost MCP 서버를 1 개 띄우고, 우리 inline 도구들을 그 서버의 tool 로 등록한다. provider mcpServers 설정에 `streamable-http` 로 추가.

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

> 인라인 MCP 우회는 `config.tools` (ai-sdk native ToolSet) 와 *별개 경로*. 두 경로가 동시에 켜질 수도 있다 — 운영자가 ai-sdk-native ToolSet (다른 provider 용 또는 future-proof) 과 인라인 MCP 우회 (claude-code/codex-cli 환경에서 실제 동작) 를 한 config 에 같이 박을 수 있다.

## v2 vs v3

| 영역                          | v2                                       | v3                                                |
| ----------------------------- | ---------------------------------------- | ------------------------------------------------- |
| MCP 서버 등록                  | `runtime-claude` 가 직접 관리              | `config.mcpServers` (1급 SPEC, step 5+ 에서 provider 병합) |
| `__native__` 컨벤션           | 우리 임시 명명 (PRD 에서 폐기)             | 사용 안 함                                        |
| ai-sdk native ToolSet         | (없음)                                    | `config.tools` 1급 — `streamText({ tools, stopWhen: stepCountIs(maxSteps) })` 4 트리거 적용 |
| inline tool (Zod)              | `defineTool()` 1급                       | `config.tools` (provider 의존 동작) → 두 provider 환경에서는 인라인 MCP 우회 |
| MCP transport 자동 reset      | `inline-mcp-bridge.ts` 자체 구현          | provider 동작 우선. 부족하면 wrapper 로 보강         |

## 검증 필요

- 두 provider 의 정확한 `mcpServers` 시그니처 (transport 종류, 환경변수 전달, timeout).
- chat-sdk 가 ai-sdk LanguageModel 호출 시 `tools` 옵션이 ai-sdk middleware 체인 → provider 까지 어떻게 전달되는지. 두 provider 가 그 tools 옵션을 무시하는지 / 일부만 받는지 (`config.tools` 경로 실효성 측정).
- 인라인 MCP 서버를 한 프로세스 안에 띄울 때 포트 충돌 / lifecycle 정리 — v2 `inline-mcp-bridge` 노하우 그대로 차용 가능.

## 검증 결과 (rev. 3)

- ✅ `streamText` 4 호출 위치 (queue / steering / step / cron) 모두 `tools` + `stopWhen: stepCountIs(maxSteps)` 적용 (cbc0208).
- ✅ `tools` 미지정 시 `stopWhen` 도 `undefined` 폴백 — single-step 텍스트 turn 으로 자연스럽게 동작.
- ✅ `maxSteps` 런타임 기본값 5 (`config.maxSteps ?? 5`).
- ✅ 인라인 MCP 우회 결정 그대로 유지 — 두 provider 환경에서는 `config.tools` 가 모델에 안 붙을 수 있어 본 경로가 실제 도구 노출 수단.

## AC

1. PoC 에이전트가 외부 MCP 서버(예: `@modelcontextprotocol/server-filesystem`) 를 등록하고 한 turn 안에서 도구 호출 가능 (step 5+ 에서 provider 병합 완료 후 측정).
2. 우리 inline 도구 1 개(예: `slack_post_message`) 를 인라인 MCP 우회로 등록해서 호출 가능.
3. `config.tools` 에 ai-sdk `tool({...})` 결과를 박은 경우, 적어도 ai-sdk-compatible provider(예: openai) 에서는 4 트리거 모두에서 tool loop 가 도는 것이 trace 로 확인된다.
4. MCP transport 단절(`Stream closed` 또는 동등) 이 발생해도 같은 turn 안에서 1 회 자동 재시도된다 (provider 자체 동작 또는 우리 wrapper).
