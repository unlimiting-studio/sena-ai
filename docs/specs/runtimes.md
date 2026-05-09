# LLM Runtimes

## 한 줄

`ai-sdk-provider-claude-code`와 `ai-sdk-provider-codex-cli` 두 community provider로 Claude Code CLI / codex CLI를 ai-sdk LanguageModel로 노출한다. **모델·reasoning 설정은 cc / codex 시스템 설정에 위임** (PRD FR-1).

## 두 provider

| 항목                | claude-code provider                          | codex-cli provider                          |
| ------------------- | --------------------------------------------- | ------------------------------------------- |
| npm 패키지          | `ai-sdk-provider-claude-code`                 | `ai-sdk-provider-codex-cli`                 |
| 의존 CLI             | `@anthropic-ai/claude-code`                  | `@openai/codex` (≥ v0.42 필요, ≥ v0.60 권장)|
| 인증                 | `claude login` (Pro/Max 구독 또는 API key)    | ChatGPT Plus/Pro 구독 또는 API key          |
| 모델                 | Opus / Sonnet / Haiku (cc 시스템 선택)        | gpt-5.x 시리즈 (provider 사전 정의 모델)     |
| streaming            | ⭕                                            | ⭕                                          |
| MCP 서버              | 1급 시민 (config로 등록)                      | 1급 시민 (config로 등록)                     |
| sandbox 모드         | n/a (Claude Code 내부)                        | `read-only` / `workspace-write` / `danger-full-access` |
| AI SDK 커스텀 Zod tool | ❌                                            | ❌                                          |
| reasoning effort     | (provider 직접 노출 ❌, cc 시스템 설정 위임)   | (provider 직접 노출 ❌, codex 시스템 설정 위임) |

## 선택 정책

`config.model`에 한 provider만 등록한다. 한 에이전트는 한 엔진을 쓴다.

```ts
// Claude Code 기반
import { claudeCode } from 'ai-sdk-provider-claude-code';
model: claudeCode({ /* mcpServers는 sena.config.ts mcpServers와 통합 */ }),

// codex CLI 기반
import { codexCli } from 'ai-sdk-provider-codex-cli';
model: codexCli({ sandboxMode: 'workspace-write' }),
```

## ai-sdk middleware 위치

provider가 반환한 LanguageModel은 `wrapLanguageModel`로 감싼다 (`docs/specs/hooks.md`). 이 단계에서 우리 미들웨어(channel context · trace) 적용.

## v2 → v3 차이

| v2                                              | v3                                                            |
| ----------------------------------------------- | -------------------------------------------------------------- |
| 자체 `runtime-claude` / `runtime-codex` 패키지 | community provider 두 개                                        |
| `reasoningEffort: 'low' \| 'medium' \| ...` 옵션 1급 | provider 옵션에서 빠짐. cc / codex 시스템 설정에 위임             |
| `defineTool()` Zod 인라인 도구 1급              | provider가 미지원. MCP 서버 우회 (`docs/specs/tools.md`)         |
| 워커 fork + IPC 직접 관리                       | provider가 자체 spawn. 우리 IPC race / drain / restart_agent 코드 사라짐 |
| `inline-mcp-bridge.ts` (자체 localhost MCP bridge) | provider 자체 MCP 통합 사용. 동작이 부족하면 1차 마이그에서 결정     |
| 모델명 임의 지정 (gpt-5.5 등)                  | provider 사전 정의 모델 목록. 신규 모델은 provider upstream PR 또는 wrapper |

## 검증 필요

- claude-code provider와 codex-cli provider가 노출하는 정확한 옵션 키 (`mcpServers`, `permissionMode`, `sandboxMode` 등).
- 두 provider가 conversation history를 어떻게 받는지 — chat-sdk가 history를 LanguageModel 입력으로 넘길 때 직렬화 형식.
- `Stream closed` 같은 transport 단절을 provider가 어떻게 다루는지 (v2 `inline-mcp-bridge` 자동 reset 동등 동작 여부).

## AC

1. PoC 에이전트의 `model`을 `claudeCode()` ↔ `codexCli()` 사이에서 한 줄 교체로 동작이 바뀐다 (다른 코드 변경 없음).
2. 두 provider 모두에서 MCP 서버 도구 호출이 한 turn 안에서 동작한다.
3. 모델 / reasoning 설정 변경이 `claude` / `codex` CLI 시스템 설정만으로 적용되고, sena config 수정 없이 반영된다.
