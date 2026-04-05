# onTurnEnd Fork & Detached 옵션

## 한 줄 요약

onTurnEnd 훅에서 기존 세션 컨텍스트를 상속한 새 세션을 분기(fork)하여, connector 응답 여부를 제어(detached)할 수 있는 기능을 추가한다.

## 문제 정의

현재 onTurnEnd 훅은 `void`만 반환할 수 있어, 턴 완료 후 추가 작업을 수행할 방법이 없다. 에이전트가 대화 내용을 바탕으로 자율적인 후속 작업(예: 대화 요약 정리, 발견한 사실 메모리 저장)을 수행하려면:

1. 기존 대화 컨텍스트를 유지한 채 새 세션에서 작업해야 한다 (원본 세션 오염 방지)
2. 후속 작업의 결과가 Slack 등 connector로 흘러가지 않아야 하는 경우가 있다

## 목표 & 성공 지표

- onTurnEnd 훅에서 `{ fork, followUp, detached }` 반환으로 후속 턴 제어 가능
- fork된 세션은 원본 sessionId로 resume하여 대화 컨텍스트 상속
- detached 옵션으로 connector 응답 억제 가능
- 레거시 hook 타입(`TurnStartHook`, `TurnEndHook`, `ErrorHook`) 및 `adaptLegacyHooks` 완전 제거

## API 인터페이스

### TurnEndResult 타입 변경

```typescript
// 기존: TurnEndResult = void
// 변경:
export type TurnEndResult = void | {
  /** 새 세션을 분기하여 followUp을 실행 */
  fork?: boolean
  /** fork/followUp 세션에서 실행할 프롬프트 */
  followUp?: string
  /** true면 connector로 응답을 보내지 않음 (fork가 true일 때만 유효) */
  detached?: boolean
}
```

### 동작 조합 매트릭스

| fork | followUp | detached | 동작 | 타이밍 |
|------|----------|----------|------|--------|
| - | - | - | void 반환, 아무것도 안 함 | - |
| - | O | - | 동일 세션에서 followUp 실행 | blocking |
| O | O | - | 새 세션 분기, 동일 conversation에 응답 | fire-and-forget |
| O | O | O | 새 세션 분기, connector 응답 없음 | fire-and-forget |
| O | - | * | followUp 없으므로 무시 | - |
| - | - | O | fork 없으므로 detached 무시 | - |

### 사용 예시

```typescript
// fork + detached: 새 세션에서 조용히 실행
onTurnEnd: [async (input) => ({
  fork: true,
  detached: true,
  followUp: '이전 대화에서 발견한 사실을 메모리에 정리해줘',
})]

// fork only: 새 세션에서 실행, 동일 conversation에 응답
onTurnEnd: [async (input) => ({
  fork: true,
  followUp: '방금 대화를 요약해줘',
})]

// followUp only (fork 없음): 기존 세션에서 이어서 실행 (blocking)
onTurnEnd: [async (input) => ({
  followUp: '추가 작업을 해줘',
})]

// void 반환: 아무것도 안 함 (기존 동작)
onTurnEnd: [async (input) => {}]
```

## 아키텍처

### TurnTrace 변경

```typescript
// 기존: followUps: string[]
// 변경:
type TurnFollowUp = {
  prompt: string
  fork: boolean
  detached: boolean
}

// TurnTrace에서:
followUps: TurnFollowUp[]
```

### Engine 레벨

`engine.processTurn()`의 onTurnEnd 루프에서 반환값을 수집하여 `TurnTrace.followUps`에 담는다. Engine은 fork 실행 자체를 담당하지 않고, 수집만 한다.

- `turnContext.metadata.forkedFrom`이 존재하는 턴(fork된 턴)에서의 fork 반환값은 조용히 무시 (중첩 fork 1단계 제한)

### Worker 레벨

Worker의 `executeTurnWithSteer`에서 `TurnFollowUp[]`을 처리:

- `fork === false`: 기존 pendingEvents에 push (blocking, 동일 세션)
- `fork === true`: `spawnForkedTurn()` 호출 (fire-and-forget)

#### spawnForkedTurn 함수

1. 원본 conversation의 sessionId를 SessionStore에서 조회
2. 해당 sessionId로 `engine.processTurn({ sessionId, input: followUp.prompt })` 호출
3. fork용 별도 conversationId 생성: `fork-{원본conversationId}-{uuid}`
4. fork 턴에서 생성된 새 sessionId는 fork conversationId로 저장 (원본 오염 방지)
5. `detached === true`면 NullOutput 사용, 아니면 원본 connector로 output 생성
6. `TurnContext.metadata.forkedFrom = 원본turnId` 설정

#### NullOutput (detached용)

```typescript
const nullOutput: ConnectorOutput = {
  showProgress: async () => {},
  sendResult: async () => {},
  sendError: async () => {},
  dispose: () => {},
}
```

## 에러 처리

- fork 턴 에러: 로그만 남기고 원본 턴에 전파하지 않음
- detached가 아닌 fork에서 에러 시: 원본 conversation에 에러 메시지 전달
- fire-and-forget이지만 내부적으로 Promise 참조 유지하여 graceful shutdown 시 대기 가능

## 동시성

- fork 턴은 별도 conversationId를 사용하므로 원본의 pending message 큐와 충돌 없음
- 동일 sessionId resume이지만, fork 턴은 원본 턴이 완전히 완료된 후(sendResult 이후) 시작하므로 SDK 레벨 충돌 없음

## 레거시 제거

### 삭제 대상

| 파일 | 삭제 내용 |
|------|-----------|
| `packages/core/src/types.ts` | `TurnStartHook`, `TurnEndHook`, `ErrorHook` 타입 |
| `packages/core/src/runtime-hooks.ts` | `adaptLegacyHooks()`, `fragmentsToContext()` |
| `packages/core/src/index.ts` | `adaptLegacyHooks` export |
| `packages/core/src/__tests__/runtime-hooks.test.ts` | `adaptLegacyHooks` 관련 전체 테스트 |
| `packages/core/src/__tests__/helpers.ts` | `createMockHook`, `createSpyEndHook`, `createSpyErrorHook` 레거시 헬퍼 |
| 관련 스펙 파일들 | 레거시 hook 타입 언급 갱신 |

## 테스트 전략

- Engine 테스트: onTurnEnd에서 void, followUp, fork+followUp, fork+followUp+detached 반환 시 TurnTrace.followUps 정합성
- Worker 테스트: blocking followUp은 pendingEvents로, fork followUp은 spawnForkedTurn으로 분기되는지
- fork 세션 테스트: 원본 sessionId로 resume 되는지, 새 conversationId가 생성되는지
- detached 테스트: NullOutput이 사용되는지, connector에 응답이 가지 않는지
- 중첩 fork 제한 테스트: fork된 턴에서 fork 반환 시 무시되는지
- 레거시 제거 후 빌드/테스트 통과
