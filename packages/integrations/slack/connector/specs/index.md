# @sena-ai/connector-slack

## 한 줄 요약

Slack 이벤트를 sena-ai `InboundEvent`로 바꾸고, 에이전트 응답을 Slack 메시지로 반영하는 코어 `Connector` 구현이다.

## 문제 정의

- Slack은 HTTP Events API와 Socket Mode라는 두 입력 경로를 제공하고, 하나의 멘션에 중복 이벤트를 보내기도 한다.
- 에이전트 응답은 단순 최종 텍스트뿐 아니라 진행 단계, 표, 파일, 취소 동작까지 Slack UX에 맞게 변환돼야 한다.

## 목표 & 성공 지표

- Slack connector가 코어 `Connector` 계약을 만족한다.
- HTTP/Socket Mode에서 동일한 이벤트 처리 규칙을 유지한다.
- 진행 중 출력, Markdown 변환, 서명 검증, 파일 다운로드까지 추적 가능한 상세 스펙으로 정리한다.

## 스펙 안정성 분류

- `Stable`
  - `conversationId` 규칙, 활성 스레드 추적, 이벤트 중복 제거 의미
  - ConnectorOutput과 HTTP 서명 검증 의미
- `Flexible`
  - thinking 메시지 문구, step 렌더링 표현, 캐시 세부
- `Experimental`
  - 추가 이벤트 타입 대응, 고급 Block Kit 확장

## 용어 정의

- `activeThreads`: 봇이 참여한 스레드를 기억하는 인메모리 집합.
- `processingEvents`: 현재 처리 중인 Slack 이벤트 dedupe 슬롯.
- `ConnectorOutput`: 진행/최종 결과를 Slack에 렌더링하는 출력 객체.

## 요구사항

- `SLACK-CONN-FR-001 [Committed][Stable]`: connector는 HTTP Events API와 Socket Mode를 모두 지원해야 한다.
- `SLACK-CONN-FR-002 [Committed][Stable]`: `app_mention`, 활성 스레드의 `message`, `reaction_added(:x:)`를 처리해야 한다.
- `SLACK-CONN-FR-003 [Committed][Stable]`: 이벤트 중복 제거와 활성 스레드 추적을 통해 동일 메시지의 이중 처리를 막아야 한다.
- `SLACK-CONN-FR-004 [Committed][Stable]`: 응답 출력은 진행 단계 누적, 최종 결과, 에러를 Slack 메시지로 표현해야 한다.
- `SLACK-CONN-FR-005 [Committed][Stable]`: Markdown 응답은 Slack mrkdwn/Block Kit로 변환돼야 한다.
- `SLACK-CONN-FR-006 [Committed][Stable]`: HTTP 모드에서는 Slack 서명 검증을 수행해야 한다.
- `SLACK-CONN-NFR-001 [Committed][Stable]`: Slack Web API 토큰은 connector 옵션을 통해서만 사용되고 외부로 노출되지 않아야 한다.

## 수용 기준 (AC)

- `SLACK-CONN-AC-001`: Given HTTP 또는 Socket Mode 설정이 있을 때 When connector를 등록하면 Then 둘 다 동일한 이벤트 처리 경로를 사용한다.
- `SLACK-CONN-AC-002`: Given `app_mention` 또는 활성 스레드 `message`가 올 때 When connector가 처리하면 Then `InboundEvent`가 엔진에 제출된다.
- `SLACK-CONN-AC-003`: Given 동일 멘션에 중복 이벤트가 올 때 When connector가 처리하면 Then dedupe 규칙으로 한 번만 처리된다.
- `SLACK-CONN-AC-004`: Given 진행/최종/에러 출력이 필요할 때 When ConnectorOutput이 렌더링하면 Then Slack 제한 내에서 업데이트/오버플로우 처리된다.
- `SLACK-CONN-AC-005`: Given Markdown 또는 테이블이 포함된 응답이 있을 때 When 변환하면 Then Slack 호환 payload가 생성된다.
- `SLACK-CONN-AC-006`: Given HTTP 이벤트 요청이 올 때 When 서명이 올바르지 않으면 Then 요청은 거부된다.

## 의존관계 맵

- Depends On: `@sena-ai/core`, Slack Web API, Slack Socket Mode
- Blocks: Slack 직접 통합 에이전트
- Parallelizable With: `tools-slack`

## 범위 경계 (Non-goals)

- 플랫폼 기반 relay 경로는 이 패키지가 아닌 `platform-connector` 책임이다.
- Slack 외 채팅 채널은 다루지 않는다.

## 제약 & 가정

- connector는 봇 토큰을 직접 보유한다.
- 스레드 활성 상태는 인메모리 기반이며 재시작 후 히스토리 조회로 일부 복구한다.

## 리스크 & 완화책

- `Risk`: Slack이 동일 멘션에 `app_mention`과 `message`를 둘 다 보내 dedupe가 실패할 수 있다.
  - `완화`: processing/processed 이중 슬롯과 `app_mention` 우선 규칙을 유지한다.
- `Risk`: Slack 메시지 제한을 넘으면 진행 출력이 깨질 수 있다.
  - `완화`: step 오버플로우 분리와 truncate 규칙을 문서화한다.

## 검증 계획

- `verify.test.ts`로 서명 검증
- `mrkdwn.test.ts`로 Markdown/table 변환
- 수동 smoke test로 Slack 이벤트, 출력, 파일 다운로드, 취소 흐름 검증

## 상세 스펙

- [connector.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/connector.md)
- [events.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/events.md)
- [output.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/output.md)
- [mrkdwn.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/mrkdwn.md)
- [verify.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/verify.md)

## 개편 메모

- AGENTS.md 가이드에 맞춰 상세 스펙 링크를 절대 경로로 정리하고 문서 간 추적성을 강화했다.
