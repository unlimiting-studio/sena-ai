# runtime — Claude 스트림 오케스트레이션

## 한 줄 요약

Claude Agent SDK 호출과 owned MCP 브리지 생명주기를 묶어 sena-ai의 `RuntimeEvent` 스트림을 생성한다.

## 상위 스펙 연결 — 관련 FR/NFR/AC ID

- Related FR: `CLAUDE-FR-001`, `CLAUDE-FR-002`, `CLAUDE-FR-003`, `CLAUDE-FR-004`, `CLAUDE-FR-005`
- Related NFR: `CLAUDE-NFR-001`
- Related AC: `CLAUDE-AC-001`, `CLAUDE-AC-002`, `CLAUDE-AC-003`, `CLAUDE-AC-004`

## Behavior

### Flow 1: SDK 옵션 조립과 첫 턴 시작

- Actor / Trigger: 워커가 `claudeRuntime().createStream()`을 호출한다.
- Preconditions: `RuntimeStreamOptions`가 전달된다.
- Main Flow:
  - system 프래그먼트만 모아 시스템 프롬프트를 만든다.
  - prepend/append 프래그먼트를 모아 첫 사용자 입력을 래핑한다.
  - inline tool이 있으면 owned MCP bridge를 기동한다.
  - inline tool은 native tool로, MCP tool은 `mcpServers`로 분리한다.
  - SDK 옵션은 model, cwd, permissionMode, disallowedTools, allowedTools, env, maxTurns, abort controller를 포함한다.
  - 첫 번째 prompt message만 읽어 query를 시작한다.
- Alternative Flow:
  - prompt iterable이 비어 있으면 빈 문자열로 query를 시작한다.
- Failure Modes:
  - 브리지 기동 실패나 SDK import 실패는 스트림 실패로 이어진다.

### Flow 2: 스트림 이벤트 변환과 세션 추적

- Actor / Trigger: Claude SDK가 메시지를 방출한다.
- Main Flow:
  - mapper가 SDK 메시지를 `RuntimeEvent`로 변환한다.
  - `session.init`가 오면 현재 세션 ID를 갱신한다.
  - `tool.start`, `progress`, `tool.end`, `result`, `error`를 그대로 yield한다.
- Alternative Flow:
  - steer로 인해 interrupt된 스트림의 `error`/`result`는 무시한다.
- Failure Modes:
  - 알 수 없는 메시지 타입은 이벤트 없이 무시된다.

### Flow 3: Steer

- Actor / Trigger: `user tool_result` 경계에서 `pendingMessages`가 존재한다.
- Main Flow:
  - `pendingMessages.drain()`으로 메시지를 가져온다.
  - 메시지를 `\n`으로 join해 다음 prompt로 사용한다.
  - 현재 stream을 interrupt하고 같은 세션으로 query를 다시 시작한다.
- Alternative Flow:
  - pending 메시지가 없으면 steer하지 않는다.
- Failure Modes:
  - interrupt가 이미 끝난 스트림에 던지는 예외는 무시한다.

### Flow 4: Native Slack 복구

- Actor / Trigger: `mapWithMeta()` 결과가 native Slack `Stream closed` 오류를 나타낸다.
- Main Flow:
  - bridge를 reset한다.
  - 현재 stream을 interrupt하고 query를 다시 시작한다.
  - 재시도는 1회로 제한한다.
- Failure Modes:
  - 같은 오류가 반복되면 다음 턴은 정상 error로 종료된다.

### Flow 5: Abort와 정리

- Actor / Trigger: 외부 `abortSignal`이 발화하거나 createStream이 종료된다.
- Main Flow:
  - 현재 iteration용 AbortController를 abort한다.
  - owned bridge를 close한다.
  - 스트림 종료 전에 남은 이벤트를 drain한다.
- Failure Modes:
  - bridge close 실패는 로그만 남기고 종료를 계속 시도한다.

## Constraints

- 첫 prompt message만 소비한다.
- `dontAsk` 모드의 기본 allowlist는 `DEFAULT_ALLOWED_TOOLS` 상수와 일치해야 한다.
- `mcp__claude_ai_Slack__*`는 항상 disallowed다.
- `apiKey`가 있으면 `ANTHROPIC_API_KEY`로 env에 주입한다.
- `envVars`가 있거나 `apiKey`가 있을 때만 env를 SDK에 전달한다.
- `permissionMode === 'bypassPermissions'`일 때만 `allowDangerouslySkipPermissions`를 true로 설정한다.
- `cwd`가 없으면 `process.cwd()`를 사용한다.
- debug 로그는 `formatDebugOptionsForLog()`를 통해 safe stringify 되어야 한다.

## Interface

### Public API

#### `claudeRuntime(options?: ClaudeRuntimeOptions): Runtime`

#### `ClaudeRuntimeOptions`

```ts
{
  model?: string
  apiKey?: string
  maxTurns?: number
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'
  allowedTools?: string[]
  disallowedTools?: string[]
}
```

#### `DEFAULT_ALLOWED_TOOLS`

`Read`, `Write`, `Edit`, `MultiEdit`, `Glob`, `Grep`, `LS`, `Bash`, `NotebookRead`, `NotebookEdit`, `Agent`, `ToolSearch`

### Internal helper contract

#### `buildToolConfig(tools: ToolPort[], runtimeInfo: RuntimeInfo)`

- 반환값: `{ mcpServers, nativeTools, allowedTools }`
- inline tool:
  - `nativeTools`에 등록한다.
  - `allowedTools`에는 bare name을 추가한다.
  - handler 결과는 text/image branded result, string, object, error로 정규화한다.
- MCP tool:
  - `mcpServers[name] = tool.toMcpConfig(runtimeInfo)`로 등록한다.
  - `allowedTools`에는 `mcp__{name}__*` 패턴을 추가한다.

#### `formatDebugOptionsForLog(sdkOptions, systemPrompt)`

- `systemPrompt`는 실제 내용이 아니라 길이만 노출한다.
- `mcpServers`는 요약 표현으로 치환한다.
- 순환 참조는 `[Circular]`로 처리한다.
- env 값은 마스킹한다.

## Realization

- `claudeRuntime()`는 runtime shell이 아니라 스트림 오케스트레이터다.
- `SdkMessageMapper`와 inline bridge는 runtime 내부에서만 결합된다.
- `buildToolConfig()`는 Claude SDK native tool 등록과 MCP 브리지 등록을 분리한다.
- `allowedTools`는 inline bare name과 MCP 패턴, 그리고 사용자 지정 allowlist를 합친 결과다.
- `disallowedTools`는 고정 Slack 차단, 런타임 disallowed, turn별 disabledTools를 합친 결과다.

## Dependencies

- Depends On: `@sena-ai/core`, `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, [`mapper.md`](./mapper.md), [`inline-mcp-bridge.md`](./inline-mcp-bridge.md).
- Blocks: core worker의 Claude runtime path.
- Parallelizable With: mapper와 bridge 검증, runtime 옵션 검증.

## AC — Given / When / Then

- Given inline tool이 없을 때 When `createStream()`이 시작되면 Then owned bridge는 생성되지 않는다.
- Given inline tool이 있을 때 When `createStream()`이 시작되면 Then owned MCP bridge가 localhost에 열리고 종료 시 close된다.
- Given `permissionMode === 'dontAsk'`이고 allowedTools가 없을 때 When SDK 옵션이 만들어지면 Then `DEFAULT_ALLOWED_TOOLS`가 사용된다.
- Given `permissionMode === 'bypassPermissions'`일 때 When SDK 옵션이 만들어지면 Then `allowDangerouslySkipPermissions`는 true다.
- Given `disabledTools`와 static disallowedTools가 있을 때 When SDK 옵션이 만들어지면 Then 둘 다 `disallowedTools`에 포함되고 Slack 차단 패턴도 항상 포함된다.
- Given pending 메시지가 tool 종료 경계에 존재할 때 When steer가 발생하면 Then 새 prompt로 재query되고 interrupted stream의 result/error는 yield되지 않는다.
- Given `Stream closed` 메타가 감지될 때 When recovery가 수행되면 Then bridge reset 후 1회만 재시도한다.
- Given `apiKey`와 env가 있을 때 When SDK 옵션이 만들어지면 Then env에는 `ANTHROPIC_API_KEY`와 기존 envVars가 포함된다.

## 개편 메모

- `claudeRuntime()`를 턴 오케스트레이션과 bridge 생명주기 중심으로 쪼개고, 내부 helper 계약까지 문서에 드러냈다.
- 실제 동작과 맞지 않기 쉬운 기본 allowlist, Slack 차단, 1회 복구 제한을 명시했다.
