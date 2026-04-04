# Markdown to Slack

## 한 줄 요약

표준 Markdown을 Slack mrkdwn 또는 Block Kit table payload로 변환한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-005`
- Related AC: `SLACK-CONN-AC-005`

## Behavior

### `SLACK-MD-01` mrkdwn 텍스트 변환

- bold/italic/strike/link/image/heading/hr/unordered list를 Slack mrkdwn 표현으로 변환한다.
- 코드 블록, 인라인 코드, 번호 목록, blockquote는 보존한다.

### `SLACK-MD-02` 테이블 변환

- 첫 번째 Markdown table은 Slack `table` block으로 변환한다.
- 추가 table은 code block으로 감싼 section에 넣는다.
- 주변 텍스트는 section block으로 분리한다.

### `SLACK-MD-03` fallback text 제공

- Block Kit를 만들더라도 알림/접근성을 위한 `text` fallback을 유지한다.

## Constraints

- `SLACK-MD-C-001`: 코드 블록 내부 문법은 변환 대상에서 제외해야 한다.
- `SLACK-MD-C-002`: Slack section text 3000자 제한을 넘으면 문단 단위로 분할해야 한다.
- `SLACK-MD-C-003`: 데이터 행 셀 수가 헤더보다 적으면 빈 문자열로 패딩해야 한다.

## Interface

- `markdownToMrkdwn(md: string): string`
- `markdownToSlack(md: string): SlackMessagePayload`
- `SlackMessagePayload`
  - `text`
  - `blocks?`

## Realization

- 모듈 경계:
  - `mrkdwn.ts`가 placeholder 보호, table parsing, block assembly를 담당한다.

## Dependencies

- Depends On: Slack Block Kit payload shape
- Blocks: [output.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/output.md), `tools-slack`
- Parallelizable With: `verify.md`

## AC

- Given 일반 Markdown이 있을 때 When `markdownToMrkdwn()`을 호출하면 Then Slack 호환 문자열이 반환된다.
- Given table이 포함된 Markdown이 있을 때 When `markdownToSlack()`을 호출하면 Then 첫 table은 table block, 추가 table은 fallback section으로 변환된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 Markdown 변환 책임과 추적 가능한 요구사항 연결을 유지했다.
