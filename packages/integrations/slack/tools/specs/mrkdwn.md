# Slack Tools Markdown / Message Parsing

## 한 줄 요약

Slack tools는 공용 Slack Markdown 패키지로 safe payload를 만들고, 조회 메시지 parser는 별도 책임으로 유지한다.

## 상위 스펙 연결

- 관련 요구사항: `SLACK-TOOLS-FR-002`, `SLACK-TOOLS-FR-003`, `SLACK-TOOLS-FR-005`
- 관련 수용 기준: `SLACK-TOOLS-AC-002`, `SLACK-TOOLS-AC-003`

## Behavior

- Trigger:
  `slack_post_message`가 Markdown을 보낼 때, 또는 `slack_get_messages`가 Slack message payload를 파싱할 때 사용된다.
- Main Flow:
  1. `slack_post_message`는 공용 패키지의 `markdownToMrkdwn()`/`markdownToSlack()`으로 safe payload를 만든다.
  2. 공용 패키지는 코드 블록을 보호하고 explicit Slack token을 보존한 채 Slack 형식으로 변환한다.
  3. 메시지 parser는 Block Kit, rich text, attachment, table을 텍스트로 정규화한다.
- Failure Modes:
  Slack에서 table block 제약을 넘는 추가 테이블은 code block section으로 폴백한다.

## Constraints

- `SLACKMRKDWN-CON-001`: 코드 블록과 인라인 코드는 변환 과정에서 손상되면 안 된다.
- `SLACKMRKDWN-CON-002`: Slack 메시지는 한 개의 table block만 직접 사용해야 한다.
- `SLACKMRKDWN-CON-003`: section text는 Slack 한도 내에서 분할되어야 한다.
- `SLACKMRKDWN-CON-004`: `slack_post_message`는 Slack auto parsing에 기대지 않는 safe mode를 기본으로 사용해야 한다.

## Interface

- 변환 함수:
  `markdownToMrkdwn(md: string): string`
  `markdownToSlack(md: string): SlackMessagePayload`
- payload:
  `{ text: string; blocks?: Array<Record<string, unknown>> }`

## Realization

- Slack Markdown 변환 책임은 공용 패키지 `@sena-ai/slack-mrkdwn`로 이동한다.
- parser는 Block Kit과 legacy attachment를 함께 지원한다.

## Dependencies

- Depends On:
  Slack Block Kit payload 규약, [../../mrkdwn/specs/index.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/mrkdwn/specs/index.md)
- Blocks:
  [tools.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/tools/specs/tools.md)
- Parallelizable With:
  connector mrkdwn 스펙

## AC

- Given Markdown 텍스트, When `slack_post_message`가 변환을 호출하면, Then 코드 블록은 유지되고 safe mode Slack 포맷이 적용되며 explicit Slack token은 보존된다.
- Given Markdown 표가 하나 이상 있을 때, When `markdownToSlack()`을 호출하면, Then 첫 표는 table block으로 변환되고 이후 표는 안전한 폴백으로 변환된다.
- Given Block Kit 메시지 조회, When parser가 이를 읽으면, Then rich text와 attachment가 읽기 쉬운 텍스트로 반환된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 Markdown 변환과 메시지 파싱의 책임 경계를 분리했다.
