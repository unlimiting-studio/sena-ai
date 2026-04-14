# Slack Connector Output

## 한 줄 요약

ConnectorOutput은 에이전트 진행 단계를 safe mode Slack 메시지로 누적 렌더링하고, 한계에 가까워지면 미리 다음 메시지로 넘긴다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-004`, `SLACK-CONN-FR-005`, `SLACK-CONN-FR-013`, `SLACK-CONN-FR-018`
- Related AC: `SLACK-CONN-AC-004`, `SLACK-CONN-AC-005`, `SLACK-CONN-AC-014`, `SLACK-CONN-AC-015`, `SLACK-CONN-AC-024`, `SLACK-CONN-AC-025`

## Behavior

### `SLACK-OUT-00` thinkingMessage 결정

- Trigger: 출력 객체 생성 시
- Main Flow:
  - `createSlackOutput()`은 `ConnectorOutputContext.metadata`에서 trigger-level `thinkingMessage`를 읽고, 전역 `thinkingMessage`도 참조한다.
  - `metadata`는 해당 turn의 `InboundEvent.raw`에서 worker가 전달하므로, pending → steer 흡수 이후에도 올바른 turn의 thinkingMessage가 보장된다. 이 보장은 worker의 `PendingMessageSource.restore()`가 개별 event의 원본 `raw`를 보존하는 것에 의존한다 (core worker 스펙 참조).
  - trigger-level이 존재하면 (`string` 또는 `false`) 전역 설정보다 우선한다.
  - trigger-level이 `false`이면 thinking message를 전송하지 않는다.
  - trigger-level이 `string`이면 해당 문자열을 thinking message로 전송한다.
  - trigger-level이 없으면(`undefined`) 전역 `thinkingMessage` 설정을 따른다.

### `SLACK-OUT-01` 진행 단계 누적

- Trigger: `showProgress(text)`
- Main Flow:
  - 새 텍스트가 이전 텍스트 prefix가 아니면 새 step으로 간주한다.
  - 누적된 step 사이에는 빈 줄 하나를 넣어 Slack에서 각 agent 출력이 붙어 보이지 않게 한다.
  - 현재 step을 업데이트하고 1500ms throttle 규칙에 따라 `chat.update` 또는 최초 `chat.postMessage`를 호출한다.
  - 다만 live preview가 soft budget에 가까워지면 throttle보다 조기 분할 판단을 우선한다.

### `SLACK-OUT-02` 최종 결과와 에러 전송

- Trigger: `sendResult(text)` 또는 `sendError(message)`
- Main Flow:
  - 진행 중 step을 flush 한다.
  - 최종 결과 또는 경고 메시지를 마지막 step으로 추가한다.
  - 최종 렌더링 후 finalized 상태로 전환한다.

### `SLACK-OUT-03` 조기 오버플로우 분리

- Trigger: live preview 또는 final payload가 Slack 한계에 가까워지거나 한계를 넘김
- Main Flow:
  - 기존 메시지를 안전한 경계에서 고정하고 새 메시지로 아직 보이지 않은 suffix부터 이어간다.
  - 단일 step이 너무 크면 step 내부에서도 prefix/suffix를 나눠 continuation message를 만든다.
  - live preview는 hard limit를 넘기기 전에 조기 rollover를 시도한다.

## Constraints

- `SLACK-OUT-C-001`: Slack 블록 제한과 섹션 길이 제한을 넘지 않도록 분할해야 한다.
- `SLACK-OUT-C-002`: API 호출은 큐로 직렬화해 update race condition을 막아야 한다.
- `SLACK-OUT-C-003`: finalize 이후 `showProgress`는 무시해야 한다.
- `SLACK-OUT-C-004`: mrkdwn text object를 사용하는 block은 기본적으로 safe mode(`verbatim: true`)를 유지해야 한다.
- `SLACK-OUT-C-005`: live preview 분할은 `msg_too_long` 실패 이전에 결정되는 것이 기본이어야 한다.
- `SLACK-OUT-C-006`: continuation message는 이미 고정된 prefix를 다시 싣지 않아야 한다.

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
  - `completedSteps`, `currentText`, `activeTs`, `frozenStepCount`, `liveStepPrefixLength`, `lastRenderTime`, `finalized`
- 렌더링:
  - 진행 중 프리뷰는 plain-text safe payload로 길이 예산을 안정적으로 관리한다.
  - 최종 결과는 공용 Slack Markdown 패키지의 `markdownToSlack()`으로 safe payload를 만든 뒤 Slack API 호출한다.
  - 조기 분할 세부 계약은 [output-rollover.md](./output-rollover.md)에서 다룬다.

## Dependencies

- Depends On: [mrkdwn.md](./mrkdwn.md), [../../mrkdwn/specs/index.md](../../mrkdwn/specs/index.md), Slack Web API
- Blocks: Slack 사용자 경험
- Parallelizable With: `events.md`

## AC

- Given progress 텍스트가 연속해서 들어올 때 When `showProgress()`를 호출하면 Then 단계 누적과 throttle 규칙이 적용된다.
- Given step 두 개 이상이 누적될 때 When Slack 메시지를 렌더링하면 Then 각 step 사이에 빈 줄이 들어가 가독성이 유지된다.
- Given 최종 결과가 들어올 때 When `sendResult()`를 호출하면 Then 최종 메시지로 정리된다.
- Given 메시지 제한을 넘을 때 When 렌더링하면 Then 새 메시지로 오버플로우가 분리된다.
- Given live preview가 soft budget에 가까울 때 When 다음 `showProgress()`가 들어오면 Then throttle보다 분할이 먼저 실행된다.
- Given 단일 step이 여러 continuation message로 이어질 때 When thread를 읽으면 Then 이미 보낸 prefix가 반복되지 않는다.
- Given 결과 텍스트에 `@name`이나 `#channel` 같은 일반 문자열이 있을 때 When 렌더링하면 Then Slack auto parsing에 기대지 않고 plain text로 남는다.
- Given trigger-level `thinkingMessage: '분석 중...'`이고 전역 `thinkingMessage: '잠시만요'`일 때 When 출력 객체가 생성되면 Then '분석 중...'이 thinking message로 전송된다.
- Given trigger-level `thinkingMessage: false`이고 전역 `thinkingMessage: '잠시만요'`일 때 When 출력 객체가 생성되면 Then thinking message가 전송되지 않는다.
- Given trigger-level `thinkingMessage`가 없고 전역 `thinkingMessage: '잠시만요'`일 때 When 출력 객체가 생성되면 Then '잠시만요'가 thinking message로 전송된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 진행 출력과 최종 결과의 계약을 문서화했다.
