# Slack Markdown Conversion

## 한 줄 요약

공용 패키지는 Markdown을 Slack safe mrkdwn/Block Kit payload로 변환한다.

## 상위 스펙 연결

- 관련 요구사항: `SLACK-MR-FR-001`, `SLACK-MR-FR-002`, `SLACK-MR-FR-003`, `SLACK-MR-FR-004`, `SLACK-MR-FR-005`, `SLACK-MR-FR-006`, `SLACK-MR-FR-007`, `SLACK-MR-FR-008`, `SLACK-MR-FR-009`
- 관련 수용 기준: `SLACK-MR-AC-001`, `SLACK-MR-AC-002`, `SLACK-MR-AC-003`, `SLACK-MR-AC-004`, `SLACK-MR-AC-005`, `SLACK-MR-AC-006`, `SLACK-MR-AC-007`, `SLACK-MR-AC-008`

## Behavior

- Actor / Trigger / Preconditions
  - connector 또는 tools가 Markdown 텍스트를 Slack payload로 변환하려고 호출한다.
- Main Flow
  1. 변환기는 코드 블록, 인라인 코드, explicit Slack token을 먼저 보호한다.
  2. 일반 Markdown 서식을 Slack safe mrkdwn으로 변환한다.
  3. 일반 텍스트의 `&`, `<`, `>`를 escape한다.
  4. table이 있으면 첫 table은 Slack `table` block으로 만들고, 주변 텍스트는 `verbatim: true`인 section block으로 분리한다.
  5. 추가 table은 안전한 fallback section으로 렌더링한다.
  6. Block Kit payload를 만들더라도 safe mode fallback text와 safe mode 전송 옵션을 함께 반환한다.
- Alternative Flow
  - table이 없어도 payload는 safe mode 전송 옵션을 반드시 포함해야 한다.
  - `markdownOrMrkdwnToSlack()`은 변환 전에 이미 Slack mrkdwn으로 작성된 inline 강조를 placeholder로 보호한 뒤, 최종 payload에 그대로 복원한다.
- Outputs / Side Effects / Failure Modes
  - 출력은 `{ text, blocks?, parse, link_names, unfurl_links, unfurl_media }` 형태다.
  - safe mode에서 이름 문자열 기반 auto parsing은 발생하지 않는다.
  - Slack 제약을 넘는 긴 텍스트는 section limit 내로 분할한다.

## Constraints

- `SLACK-MR-CON-001`: 코드 블록과 인라인 코드는 변환 중 손상되면 안 된다.
- `SLACK-MR-CON-002`: explicit Slack token은 escape되거나 분해되면 안 된다.
- `SLACK-MR-CON-003`: mrkdwn text object를 사용하는 block은 기본적으로 `verbatim: true`여야 한다.
- `SLACK-MR-CON-004`: Slack 메시지 하나에는 직접 `table` block을 최대 1개만 사용해야 한다.
- `SLACK-MR-CON-005`: section text는 Slack 3000자 제한 안으로 분할해야 한다.
- `SLACK-MR-CON-006`: connector와 tools는 로컬 포크 구현이 아니라 이 공용 패키지를 사용해야 한다.
- `SLACK-MR-CON-007`: `markdownToSlack()` 반환 payload는 no-table 경로에서도 `parse: 'none'`, `link_names: false`, `unfurl_links: false`, `unfurl_media: false`를 포함해야 한다.

## Interface

- API
  - `markdownToMrkdwn(md: string): string`
  - `markdownToSlack(md: string): SlackMessagePayload`
  - `markdownOrMrkdwnToSlack(md: string): SlackMessagePayload`
- Schema
  - `SlackMessagePayload`
    - `text: string`
    - `blocks?: Array<Record<string, unknown>>`
    - `parse: 'none'`
    - `link_names: false`
    - `unfurl_links: false`
    - `unfurl_media: false`

## Realization

- 모듈 경계
  - 공용 패키지가 Markdown to Slack 변환만 담당한다.
  - 메시지 조회 parser는 tools 패키지에 남긴다.
- 상태 모델
  - placeholder 집합, 세그먼트 목록, table 사용 여부, 남은 section text
- 동시성
  - 순수 함수 기반 구현으로 외부 상태를 가지지 않는다.
- 실패 처리
  - table block으로 안전하게 표현할 수 없는 추가 table은 fallback section으로 내린다.
- 배포
  - workspace package로 배치하고 connector/tools가 dependency + TS reference로 연결한다.
- 마이그레이션
  - 기존 connector/tools 로컬 구현은 제거하고 import 경로를 공용 패키지로 교체한다.

## Dependencies

- Depends On: Slack Block Kit payload 규약
- Blocks: connector 출력, `slack_post_message`
- Parallelizable With: connector/tools의 parser 관련 정리

## AC

- Given `a < b & c > d`가 있을 때 When `markdownToMrkdwn()`을 호출하면 Then safe mode escape가 적용된다.
- Given `<@U123>`, `<#C123>`, `<https://example.com|문서>`가 있는 텍스트일 때 When 변환하면 Then token이 그대로 유지된다.
- Given `@alice`, `#general`이 있는 텍스트일 때 When 변환하면 Then 일반 문자열 그대로 남고 auto parsing에 의존하지 않는다.
- Given table이 없는 일반 메시지일 때 When `markdownToSlack()`을 호출하면 Then payload는 `parse: 'none'`, `link_names: false`, `unfurl_links: false`, `unfurl_media: false`를 포함한다.
- Given table과 주변 설명문이 함께 있을 때 When `markdownToSlack()`을 호출하면 Then 설명문 section block은 `verbatim: true`를 가진다.
- Given table이 두 개 이상일 때 When `markdownToSlack()`을 호출하면 Then 첫 table만 table block이고 이후 table은 fallback section이 된다.
- Given connector와 tools가 같은 입력을 쓸 때 When 각각 렌더링하면 Then 공용 패키지 import를 통해 같은 semantics를 가진 payload를 만든다.
- Given 입력에 이미 Slack mrkdwn 형태의 `*중요*`가 있을 때 When `markdownOrMrkdwnToSlack()`을 호출하면 Then 이 구간은 `_중요_`로 바뀌지 않는다.
