# Slack Tools Markdown / Message Parsing

## 한 줄 요약

Slack tools용 `mrkdwn` 모듈은 Markdown을 Slack payload로 변환하고 조회 메시지의 Block Kit/attachment를 읽기 쉬운 텍스트로 풀어낸다.

## 상위 스펙 연결

- 관련 요구사항: `SLACK-TOOLS-FR-002`, `SLACK-TOOLS-FR-003`
- 관련 수용 기준: `SLACK-TOOLS-AC-002`, `SLACK-TOOLS-AC-003`

## Behavior

- Trigger:
  `slack_post_message`가 Markdown을 보낼 때, 또는 `slack_get_messages`가 Slack message payload를 파싱할 때 사용된다.
- Main Flow:
  1. `markdownToMrkdwn()`은 코드 블록을 보호한 뒤 bold/italic/link/list/hr/headings를 Slack 형식으로 바꾼다.
  2. `markdownToSlack()`은 테이블이 없으면 plain text payload, 있으면 section/table block 조합 payload를 반환한다.
  3. 메시지 parser는 Block Kit, rich text, attachment, table을 텍스트로 정규화한다.
- Failure Modes:
  Slack에서 table block 제약을 넘는 추가 테이블은 code block section으로 폴백한다.

## Constraints

- `SLACKMRKDWN-CON-001`: 코드 블록과 인라인 코드는 변환 과정에서 손상되면 안 된다.
- `SLACKMRKDWN-CON-002`: Slack 메시지는 한 개의 table block만 직접 사용해야 한다.
- `SLACKMRKDWN-CON-003`: section text는 Slack 한도 내에서 분할되어야 한다.

## Interface

- 변환 함수:
  `markdownToMrkdwn(md: string): string`
  `markdownToSlack(md: string): SlackMessagePayload`
- payload:
  `{ text: string; blocks?: Array<Record<string, unknown>> }`

## Realization

- placeholder 전략으로 코드/링크/헤딩을 보호한다.
- 테이블 탐지, 세그먼트 분리, 정렬 파싱, section 분할을 단계적으로 수행한다.
- parser는 Block Kit과 legacy attachment를 함께 지원한다.

## Dependencies

- Depends On:
  Slack Block Kit payload 규약
- Blocks:
  [tools.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/tools/specs/tools.md)
- Parallelizable With:
  connector mrkdwn 스펙

## AC

- Given Markdown 텍스트, When `markdownToMrkdwn()`을 호출하면, Then 코드 블록은 유지되고 Slack 스타일 포맷이 적용된다.
- Given Markdown 표가 하나 이상 있을 때, When `markdownToSlack()`을 호출하면, Then 첫 표는 table block으로 변환되고 이후 표는 안전한 폴백으로 변환된다.
- Given Block Kit 메시지 조회, When parser가 이를 읽으면, Then rich text와 attachment가 읽기 쉬운 텍스트로 반환된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 Markdown 변환과 메시지 파싱의 책임 경계를 분리했다.
