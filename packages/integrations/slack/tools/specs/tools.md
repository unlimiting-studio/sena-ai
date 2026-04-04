# Slack Tool Catalog

## 한 줄 요약

Slack tool catalog는 메시지 조회/전송, 채널 조회, 파일 업로드/다운로드, 사용자 조회 도구의 입력과 반환 형식을 고정한다.

## 상위 스펙 연결

- 관련 요구사항: `SLACK-TOOLS-FR-001`, `SLACK-TOOLS-FR-002`, `SLACK-TOOLS-FR-003`, `SLACK-TOOLS-FR-004`, `SLACK-TOOLS-NFR-001`
- 관련 수용 기준: `SLACK-TOOLS-AC-001`, `SLACK-TOOLS-AC-002`, `SLACK-TOOLS-AC-003`, `SLACK-TOOLS-AC-004`

## Behavior

- Trigger:
  에이전트가 `slackTools({ botToken })`을 호출한다.
- Main Flow:
  1. Slack WebClient를 생성한다.
  2. `slack_get_messages`, `slack_post_message`, `slack_list_channels`, `slack_upload_file`, `slack_get_users`, `slack_download_file`를 등록한다.
  3. 사용자 이름과 채널 목록 캐시를 유지한다.
  4. 조회 계열 도구는 JSON 문자열을 반환하고 전송 계열 도구는 최소 결과 JSON을 반환한다.
- Failure Modes:
  사용자 이름 조회 실패는 userId 자체를 캐시한다.
  파일 다운로드 실패는 적절한 오류 또는 축약된 정보로 반환한다.

## Constraints

- `SLACKTOOLS-CON-001`: `ALLOWED_SLACK_TOOLS`는 실제 등록 도구 이름과 동일해야 한다.
- `SLACKTOOLS-CON-002`: 채널 목록 캐시는 1시간 TTL 슬라이딩 만료를 가져야 한다.
- `SLACKTOOLS-CON-003`: `slack_get_messages`는 thread/channel 모드를 모두 지원해야 한다.

## Interface

- 팩토리:
  `slackTools(options: SlackToolsOptions): ToolPort[]`
- 옵션:
  `botToken: string`
- 등록 도구:
  `slack_get_messages`
  `slack_post_message`
  `slack_list_channels`
  `slack_upload_file`
  `slack_get_users`
  `slack_download_file`

## Realization

- Web API 호출은 `@slack/web-api` client 하나를 공유한다.
- `slack_get_messages`는 Block Kit/attachment parser를 사용한다.
- `slack_download_file`는 OS temp dir 아래 `slack-files/`에 저장한다.

## Dependencies

- Depends On:
  [mrkdwn.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/tools/specs/mrkdwn.md), [core tool contract](/Users/channy/workspace/sena-ai/packages/core/specs/tool.md), Slack Web API
- Blocks:
  Slack tool 사용 경로 전반
- Parallelizable With:
  connector 출력 스펙

## AC

- Given `slack_get_messages`, When thread 조회를 실행하면, Then 사용자 이름이 해소된 메시지 JSON 배열이 반환된다.
- Given `slack_list_channels`, When 같은 파라미터로 반복 호출하면, Then 캐시된 결과를 재사용할 수 있다.
- Given `slack_download_file`, When 다운로드가 성공하면, Then 로컬 파일 경로가 포함된 JSON이 반환된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 도구 카탈로그의 요구사항과 검증 기준을 구체화했다.
