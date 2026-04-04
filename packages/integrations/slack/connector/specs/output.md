# Slack Connector Output

## 한 줄 요약

ConnectorOutput은 에이전트 진행 단계를 Slack 메시지로 누적 렌더링하고, 한계 초과 시 메시지를 분할한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-004`, `SLACK-CONN-FR-005`
- Related AC: `SLACK-CONN-AC-004`, `SLACK-CONN-AC-005`

## Behavior

### `SLACK-OUT-01` 진행 단계 누적

- Trigger: `showProgress(text)`
- Main Flow:
  - 새 텍스트가 이전 텍스트 prefix가 아니면 새 step으로 간주한다.
  - 누적된 step 사이에는 빈 줄 하나를 넣어 Slack에서 각 agent 출력이 붙어 보이지 않게 한다.
  - 현재 step을 업데이트하고 1500ms throttle 규칙에 따라 `chat.update` 또는 최초 `chat.postMessage`를 호출한다.

### `SLACK-OUT-02` 최종 결과와 에러 전송

- Trigger: `sendResult(text)` 또는 `sendError(message)`
- Main Flow:
  - 진행 중 step을 flush 한다.
  - 최종 결과 또는 경고 메시지를 마지막 step으로 추가한다.
  - 최종 렌더링 후 finalized 상태로 전환한다.

### `SLACK-OUT-03` 오버플로우 분리

- Trigger: 블록 수 또는 텍스트 길이 제한 초과
- Main Flow:
  - 기존 메시지를 고정하고 새 메시지로 최근 step부터 이어간다.
  - 단일 step이 너무 크면 truncate 표시를 추가한다.

## Constraints

- `SLACK-OUT-C-001`: Slack 블록 제한과 섹션 길이 제한을 넘지 않도록 분할해야 한다.
- `SLACK-OUT-C-002`: API 호출은 큐로 직렬화해 update race condition을 막아야 한다.
- `SLACK-OUT-C-003`: finalize 이후 `showProgress`는 무시해야 한다.

## Interface

- `ConnectorOutput`
  - `showProgress(text)`
  - `sendResult(text)`
  - `sendError(message)`
  - `dispose()`

## Realization

- 모듈 경계:
  - `connector.ts` 내부 `createSlackOutput()`이 구현한다.
- 상태 모델:
  - `completedSteps`, `currentText`, `activeTs`, `frozenStepCount`, `lastRenderTime`, `finalized`
- 렌더링:
  - `markdownToSlack()`으로 변환 후 Slack API 호출

## Dependencies

- Depends On: [mrkdwn.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/mrkdwn.md), Slack Web API
- Blocks: Slack 사용자 경험
- Parallelizable With: `events.md`

## AC

- Given progress 텍스트가 연속해서 들어올 때 When `showProgress()`를 호출하면 Then 단계 누적과 throttle 규칙이 적용된다.
- Given step 두 개 이상이 누적될 때 When Slack 메시지를 렌더링하면 Then 각 step 사이에 빈 줄이 들어가 가독성이 유지된다.
- Given 최종 결과가 들어올 때 When `sendResult()`를 호출하면 Then 최종 메시지로 정리된다.
- Given 메시지 제한을 넘을 때 When 렌더링하면 Then 새 메시지로 오버플로우가 분리된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 진행 출력과 최종 결과의 계약을 문서화했다.
