# mapper — Claude SDK 메시지 매핑

## 한 줄 요약

Claude SDK 메시지를 sena-ai `RuntimeEvent`로 변환하고, tool_use/tool_result의 id 연결을 유지한다.

## 상위 스펙 연결 — 관련 FR/NFR/AC ID

- Related FR: `CLAUDE-FR-002`, `CLAUDE-FR-004`
- Related AC: `CLAUDE-AC-002`, `CLAUDE-AC-004`

## Behavior

### Flow 1: system init 매핑

- Actor / Trigger: SDK가 `system` 메시지(`subtype: 'init'`)를 보낸다.
- Preconditions: `session_id`가 존재한다.
- Main Flow:
  - `session.init` 이벤트를 emit한다.
  - mcp 서버 목록과 사용 가능한 MCP tool 요약은 디버그 로그로 남긴다.
- Failure Modes:
  - `session_id`가 없으면 이벤트를 내지 않는다.

### Flow 2: assistant 메시지 매핑

- Actor / Trigger: SDK가 `assistant` 메시지를 보낸다.
- Main Flow:
  - content 안의 `tool_use` 블록마다 `tool.start`를 emit한다.
  - `tool_use`의 `id`와 `name`을 내부 맵에 저장한다.
  - text 블록들은 모두 이어붙여 `progress`로 emit한다.
- Alternative Flow:
  - tool_use와 text가 같은 메시지에 있으면 둘 다 순서대로 emit한다.

### Flow 3: user tool_result 매핑

- Actor / Trigger: SDK가 `user` 메시지 안에 `tool_result`를 보낸다.
- Main Flow:
  - `tool_use_id`로 저장된 toolName을 복원한다.
  - toolName을 찾으면 map에서 제거한다.
  - `tool.end`와 `ToolResultMeta`를 함께 만든다.
- Failure Modes:
  - id를 찾지 못하면 toolName은 `unknown`이 된다.

### Flow 4: result/error 매핑

- Actor / Trigger: SDK가 `result` 메시지를 보낸다.
- Main Flow:
  - subtype이 `success`면 `result` 이벤트를 emit한다.
  - 그 외 subtype이면 `errors` 배열을 `; `로 join한 `error` 이벤트를 emit한다.
- Alternative Flow:
  - `result` 텍스트가 비어 있어도 result 이벤트는 emit된다.

### Flow 5: stateless convenience mapping

- Actor / Trigger: 호출부가 `mapSdkMessage()`를 사용한다.
- Main Flow:
  - 새 `SdkMessageMapper()`를 만든 뒤 단일 메시지만 변환한다.
  - tool.end의 이름 복원은 기대하지 않는다.

## Constraints

- `tool_use`/`tool_result` 연결은 메시지 인스턴스 수명 동안만 유지된다.
- `mapSdkMessage()`는 stateless라서 연속 메시지의 toolName 복원을 보장하지 않는다.
- 알 수 없는 메시지 타입은 빈 이벤트 배열로 처리한다.

## Interface

### `SdkMessageMapper`

```ts
class SdkMessageMapper {
  map(msg: any): RuntimeEvent[]
  mapWithMeta(msg: any): { events: RuntimeEvent[]; toolResults: ToolResultMeta[] }
}
```

### `ToolResultMeta`

```ts
{
  toolName: string
  isError: boolean
  errorText?: string
}
```

### `mapSdkMessage(msg: any): RuntimeEvent[]`

단일 메시지용 stateless 래퍼.

## Realization

- 내부 `Map<string, string>`이 `tool_use` id → tool name을 기억한다.
- `tool_result` 처리 후에는 해당 id를 제거해 중복 매핑을 방지한다.
- `extractToolResultText()`는 문자열 또는 text 블록 배열에서 사람이 읽을 수 있는 에러 텍스트를 추출한다.
- `mapWithMeta()`는 브리지 재연결 판별용 metadata를 제공한다.

## Dependencies

- Depends On: `@sena-ai/core`의 `RuntimeEvent`.
- Blocks: runtime의 session tracking, steer, native Slack recovery.
- Parallelizable With: runtime 스트림 오케스트레이션과 inline bridge 문서.

## AC — Given / When / Then

- Given `system` init 메시지에 `session_id`가 있고 When mapper가 이를 받으면 Then `session.init` 이벤트가 반환된다.
- Given assistant 메시지에 `tool_use`와 text 블록이 있고 When mapper가 이를 받으면 Then `tool.start`와 `progress`가 순서대로 반환된다.
- Given user 메시지의 `tool_result`가 앞선 `tool_use_id`를 참조하고 When mapper가 이를 받으면 Then 복원된 toolName으로 `tool.end`가 반환된다.
- Given 동일 `tool_use_id`에 대해 두 번 `tool_result`가 오면 When 두 번째를 매핑하면 Then toolName은 `unknown`이다.
- Given result subtype이 `success`이면 When mapper가 이를 받으면 Then `result` 이벤트가 반환된다.
- Given result subtype이 실패면 When mapper가 이를 받으면 Then `errors` 배열을 join한 `error` 이벤트가 반환된다.
- Given 알 수 없는 message type이면 When mapper가 이를 받으면 Then 빈 배열이 반환된다.

## 개편 메모

- tool_use/tool_result의 상태 의존성을 별도 책임으로 분리해, 런타임 steer와 복구 로직이 기대하는 메타데이터를 명확히 했다.
- stateless 래퍼와 stateful mapper의 차이를 문서에서 분리해 오해를 줄였다.
