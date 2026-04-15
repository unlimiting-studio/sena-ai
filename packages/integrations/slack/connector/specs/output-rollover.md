# Slack Output Live Rollover

## 1. 한 줄 요약 (Outcome Statement)

stream helper를 바로 쓸 수 없는 호환 경로나 final safe payload chunking 경로에서, 긴 출력이 Slack 한계에 가까워지면 `ConnectorOutput`이 실패를 기다리지 않고 현재 메시지를 안전한 지점에서 고정한 뒤 다음 메시지로 자연스럽게 이어 준다.

---

## 2. 상위 스펙 연결 (Traceability)

- Related Goals:
  - 호환 경로의 긴 진행 중 출력에서도 프리뷰가 멈춘 것처럼 보이지 않게 한다.
  - Slack hard limit에 닿기 전에 continuation 메시지로 넘겨 `msg_too_long`를 정상 흐름에서 없앤다.
- Related Requirements (FR/NFR ID):
  - `SLACK-CONN-FR-004`
  - `SLACK-CONN-FR-018`
- Related AC:
  - `SLACK-CONN-AC-004`
  - `SLACK-CONN-AC-024`
  - `SLACK-CONN-AC-025`

---

## 3. Behavior Specification

### 3.1 Flow 목록

#### Flow ID: SLACK-OUT-ROLLOVER-01

- Actor:
  `ConnectorOutput`
- Trigger:
  stream helper를 바로 쓸 수 없는 호환 경로에서 `showProgress(text)`가 호출됨
- Preconditions:
  - `finalized = false`
  - 현재 turn에 대응하는 Slack thread가 존재한다.
- Main Flow:
  1. 출력기는 `completedSteps`, 현재 step의 최신 텍스트, 그리고 이전 rollover에서 이미 고정한 prefix 길이를 합쳐 이번 프리뷰 후보를 만든다.
  2. 진행 중 프리뷰는 plain-text safe payload 후보를 만든 뒤 text 길이 기준으로 측정한다.
  3. 측정값이 live soft budget 아래면 기존 throttle 규칙을 유지한다.
  4. 측정값이 live soft budget에 닿았거나, 다음 한 번의 update만으로 hard limit를 넘길 가능성이 높으면 throttle보다 rollover 판단을 우선한다.
  5. rollover가 필요하다고 판단되면 즉시 렌더 큐에 올려 현재 프리뷰를 안전한 지점에서 나눈다.
- Outputs:
  - `normal` 또는 `urgent` 상태의 렌더 계획
- Failure Modes:
  - text 기준과 block 기준의 측정값이 다르게 나와 safe budget 추정이 빗나감

#### Flow ID: SLACK-OUT-ROLLOVER-02

- Actor:
  `ConnectorOutput`
- Trigger:
  호환 경로에서 `SLACK-OUT-ROLLOVER-01`이 `urgent`로 판정됨
- Preconditions:
  - `activeTs`가 존재한다.
- Main Flow:
  1. 출력기는 blank line, newline, space 순서로 자연스러운 split boundary를 찾는다.
  2. 현재 active message는 boundary 이전까지만 포함한 상태로 고정한다.
  3. boundary 이후의 unseen suffix는 새 active message의 시작점으로 넘긴다.
  4. 이후 `showProgress()`는 새 active message만 갱신한다.
- Alternative Flow:
  - 자연스러운 경계를 못 찾으면 hard index 근처에서 강제로 나누되, 순서는 유지한다.
  - 하나의 step 자체가 너무 길면 step 내부에서도 같은 규칙으로 prefix/suffix를 나눈다.
- Outputs:
  - 고정된 이전 메시지 1개
  - 이어서 갱신할 새 active message 1개
- Side Effects:
  - `activeTs`가 새 continuation 메시지로 바뀐다.
  - 현재 step에서 이미 고정한 prefix 길이가 증가한다.
- Failure Modes:
  - continuation 시작점 계산이 잘못돼 prefix가 다시 보이거나 일부 문장이 빠짐

#### Flow ID: SLACK-OUT-ROLLOVER-03

- Actor:
  `ConnectorOutput`
- Trigger:
  `sendResult(text)`
- Preconditions:
  - 하나 이상의 rollover가 이미 발생했을 수 있다.
- Main Flow:
  1. 출력기는 이전 rollover에서 이미 고정한 prefix를 final render에서 다시 싣지 않는다.
  2. 아직 active message에 남아 있는 unseen tail을 final 첫 chunk로 바꾼다.
  3. 남은 final 텍스트는 non-overlapping continuation chunk로 같은 thread에 순서대로 보낸다.
- Outputs:
  - 사용자가 thread 전체를 위에서 아래로 읽으면 끊김 없이 이어지는 최종 답변
- Failure Modes:
  - live prefix cursor와 final chunk 시작점이 어긋나면 문장이 겹치거나 빠짐

---

## 4. Constraint Specification

### Constraint ID: SLACK-OUT-ROLL-C-001

- Category:
  Reliability
- Description:
  live preview 분할은 hard Slack limit를 넘기기 전에 결정돼야 하며, `msg_too_long`는 정상 흐름에서 없어야 한다.
- Scope:
  `SLACK-OUT-ROLLOVER-01`
- Measurement:
  live preview는 hard limit보다 작은 soft budget을 사용한다.
- Verification:
  near-limit progress 테스트에서 Slack API rejection 없이 continuation message가 생기는지 본다.
- Related Behavior:
  `SLACK-OUT-ROLLOVER-01`

### Constraint ID: SLACK-OUT-ROLL-C-002

- Category:
  Responsiveness
- Description:
  soft budget 근처에서는 1500ms throttle이 rollover를 늦추면 안 된다.
- Scope:
  `SLACK-OUT-ROLLOVER-01`
- Measurement:
  urgent 상태에서는 trailing render를 기다리지 않고 즉시 분할 경로로 들어간다.
- Verification:
  throttle window 안에서 새 progress가 들어와도 continuation message가 바로 생기는 테스트를 둔다.
- Related Behavior:
  `SLACK-OUT-ROLLOVER-01`, `SLACK-OUT-ROLLOVER-02`

### Constraint ID: SLACK-OUT-ROLL-C-003

- Category:
  Correctness
- Description:
  rollover 이후 thread 전체를 이어 읽었을 때 prefix/suffix 중복이나 누락이 없어야 한다.
- Scope:
  `SLACK-OUT-ROLLOVER-02`, `SLACK-OUT-ROLLOVER-03`
- Measurement:
  각 continuation message는 이전 메시지의 마지막 경계 뒤에서 시작한다.
- Verification:
  단일 long step과 final chunk를 합친 회귀 테스트로 확인한다.
- Related Behavior:
  `SLACK-OUT-ROLLOVER-02`, `SLACK-OUT-ROLLOVER-03`

### Constraint ID: SLACK-OUT-ROLL-C-004

- Category:
  Compatibility
- Description:
  split 판단은 진행 중 프리뷰용 plain text 길이를 기준으로 안정적으로 이뤄져야 하며, final render의 block 제약과 섞여서 흔들리면 안 된다.
- Scope:
  `SLACK-OUT-ROLLOVER-01`
- Measurement:
  live preview는 plain-text payload 길이로 측정하고, final render는 별도의 block 제약을 따른다.
- Verification:
  live preview와 final render가 서로 다른 길이 관리 규칙을 갖는 회귀 테스트로 검증한다.
- Related Behavior:
  `SLACK-OUT-ROLLOVER-01`

## 5. Interface Specification

### 5.1 ConnectorOutput Contract

- Public Interface:
  - `showProgress(text)`
  - `sendResult(text)`
  - `sendError(message)`
  - `dispose()`
- User-visible Behavior:
  - 호환 경로의 긴 진행 중 출력은 같은 thread 안에서 여러 메시지로 이어질 수 있다.
  - continuation message의 첫 문장은 직전 메시지에 이미 보인 prefix를 반복하지 않는다.
  - stream helper를 바로 쓸 수 없는 경우에만 기존 단일 메시지 갱신 UX를 유지한다.

### 5.2 Observability Contract

- 로그에는 rollover reason(`soft_limit`, `predicted_limit`)과 split 전후 길이를 남긴다.
- 같은 oversized payload를 같은 active message에 반복 재시도했다는 로그는 허용하지 않는다.

---

## 6. Realization Specification

- Module Boundaries:
  - 구현 위치는 `packages/integrations/slack/connector/src/connector.ts` 내부 `createSlackOutput()`
  - split boundary 계산은 helper로 분리 가능하다.
- Data Ownership:
  - `completedSteps`: step 단위로 완전히 고정된 텍스트
  - `currentText`: 현재 step의 최신 전체 텍스트
  - `liveStepPrefixLength`: 호환 경로의 plain-text live preview에서 이전 메시지들에 이미 고정한 prefix 길이
  - `activeTs`: 지금 갱신 중인 Slack message ts
- State Model:
  - 새 step이 시작되면 `liveStepPrefixLength`는 0으로 리셋한다.
  - rollover가 일어나면 `liveStepPrefixLength`를 split boundary만큼 늘린다.
  - final render는 `currentText.slice(liveStepPrefixLength)`를 기준으로 남은 tail만 마무리한다.
- Concurrency Strategy:
  - Slack API 호출 직렬화 큐는 유지한다.
  - urgent rollover는 기존 throttle 대기보다 앞선 우선순위를 가진다.
- Failure Handling:
  - stream 경로가 우선이고, 이 문서는 plain-text soft budget 기반 호환 경로를 다룬다.
  - 예산 계산과 실제 Slack 제한이 어긋나면 로그를 남기고 원인을 먼저 수정한다.
- Observability Plan:
  - rollover 횟수, reason, split boundary를 로그로 남긴다.
- Migration / Rollback:
  - 외부 설정 스키마 변경은 없다.
  - 문제가 생기면 기존 truncate-only live preview로 쉽게 되돌릴 수 있게 helper 경계를 분리한다.

---

## 7. Dependency Map

- Depends On:
  - [output.md](./output.md)
  - [mrkdwn.md](./mrkdwn.md)
  - Slack Web API
- Blocks:
  - 긴 Slack 응답의 실시간 가독성
- Parallelizable With:
  - `events.md`

---

## 8. Acceptance Criteria

- Given stream helper를 바로 쓸 수 없는 호환 경로에서 활성 프리뷰 메시지가 soft budget 근처이고 throttle window 안일 때 When 다음 `showProgress()`가 들어오면 Then connector는 throttle을 그대로 기다리지 않고 continuation message를 먼저 만든다.
- Given 하나의 진행 step이 한 메시지 예산보다 길 때 When rollover가 일어나면 Then 새 continuation message는 이미 보낸 prefix가 아닌 unseen suffix로 시작한다.
- Given 이전에 rollover가 여러 번 있었을 때 When `sendResult()`가 끝나면 Then thread 전체를 합친 텍스트는 중복이나 누락 없이 최종 답변과 같은 순서를 가진다.
- Given stream helper를 바로 쓸 수 없는 호환 경로에서 짧은 진행 중 출력일 때 When `showProgress()`와 `sendResult()`를 호출하면 Then 기존 단일 메시지 갱신 동작은 유지된다.
