# @sena-ai/tools-slack

## 한 줄 요약

에이전트가 Slack 채널, 스레드, 파일, 사용자 정보를 읽고 쓰도록 하는 inline 도구 묶음을 제공한다.

## 문제 정의

- Slack connector만으로는 현재 대화 외 다른 채널/스레드/파일을 탐색하거나 메시지를 발송할 수 없다.
- 에이전트가 Slack API를 직접 다루지 않고도 구조화된 도구 집합으로 상호작용해야 한다.

## 목표 & 성공 지표

- 도구 팩토리 하나로 Slack 관련 inline 도구 배열을 얻는다.
- 메시지 조회/전송, 채널 목록, 파일 업로드/다운로드, 사용자 조회가 문서화된 계약으로 제공된다.

## 스펙 안정성 분류

- `Stable`: 도구 이름, 파라미터, 반환 의미
- `Flexible`: 캐시 TTL, 텍스트 파서 세부
- `Experimental`: 추가 Slack 도구 확장

## 용어 정의

- `Inline Tool`: 런타임 내부에서 직접 실행되는 도구 포트.
- `Slack Tool Suite`: Slack 상호작용용 6개 기본 도구 묶음.

## 요구사항

- `SLACK-TOOLS-FR-001 [Committed][Stable]`: 6개 기본 도구를 inline tool로 제공해야 한다.
- `SLACK-TOOLS-FR-002 [Committed][Stable]`: 메시지 조회는 thread/channel 모드와 Block Kit/attachment 파싱을 지원해야 한다.
- `SLACK-TOOLS-FR-003 [Committed][Stable]`: 메시지 전송은 Markdown을 Slack payload로 변환해야 한다.
- `SLACK-TOOLS-FR-004 [Committed][Stable]`: 파일 업로드/다운로드와 사용자/채널 조회를 지원해야 한다.
- `SLACK-TOOLS-NFR-001 [Committed][Stable]`: 모든 도구는 `@sena-ai/core` `ToolPort` 계약을 사용해야 한다.

## 수용 기준 (AC)

- `SLACK-TOOLS-AC-001`: Given `slackTools()`를 호출할 때 When 도구 배열을 받으면 Then 모든 도구가 inline type이고 기대한 이름을 가진다.
- `SLACK-TOOLS-AC-002`: Given 메시지 조회 도구를 사용할 때 When thread/channel 조회를 실행하면 Then 사람이 읽기 쉬운 텍스트가 반환된다.
- `SLACK-TOOLS-AC-003`: Given 메시지 전송 도구를 사용할 때 When Markdown 텍스트를 보내면 Then Slack 호환 payload가 전송된다.
- `SLACK-TOOLS-AC-004`: Given 파일/사용자/채널 도구를 사용할 때 When 호출하면 Then 문서화된 JSON 응답을 반환한다.

## 범위 경계 (Non-goals)

- connector 수준의 inbound event 처리
- Slack 앱 프로비저닝이나 OAuth 처리

## 제약 & 가정

- 도구는 bot token을 직접 사용한다.
- 로컬 파일 다운로드는 임시 디렉터리 접근이 가능한 환경을 가정한다.

## 리스크 & 완화책

- Slack payload drift 리스크:
  응답 포맷이 Slack API 변경에 영향을 받을 수 있다.
  완화: tool-suite 상세 스펙과 테스트에서 public shape를 고정한다.

## 검증 계획

- `slackTools.test.ts`로 도구 이름/타입/기본 구조를 검증한다.
- 수동 검증으로 메시지/파일/사용자/채널 도구를 실제 Slack workspace에서 확인한다.

## 상세 스펙

- [tools.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/tools/specs/tools.md)
- [mrkdwn.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/tools/specs/mrkdwn.md)

## 개편 메모

- AGENTS.md 가이드에 맞춰 상위 스펙 필수 섹션과 상세 스펙 링크를 정렬했다.
- 구현 계약은 바꾸지 않고 도구 카탈로그와 Markdown 파싱 책임만 분리했다.
