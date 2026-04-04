# @sena-ai/connector-slack

## 한 줄 요약

Slack 이벤트를 sena-ai `InboundEvent`로 바꾸고, 에이전트 응답을 Slack 메시지로 반영하는 코어 `Connector` 구현이다.

## 문제 정의

- Slack은 HTTP Events API와 Socket Mode라는 두 입력 경로를 제공하고, 하나의 사용자 액션에 대해 `app_mention`, `message`, `reaction_added`가 겹쳐 관찰될 수 있다.
- 기존 connector는 멘션/활성 스레드/`:x:` 취소가 하드코딩돼 있어, 채널 메시지 반응이나 리액션별 프롬프트 같은 운영 정책을 설정으로 선언하기 어렵다.
- 프롬프트를 인라인 문자열로만 두면 재사용과 유지보수가 불편하고, 이벤트별 행동 차이를 문서와 코드가 함께 추적하기 어렵다.
- 이벤트 발생 직후 무시 여부를 세밀하게 결정할 표면이 없어, 채널/작성자/본문 기준 예외 처리를 선언형으로 쓰기 어렵다.

## 목표 & 성공 지표

- Slack connector가 코어 `Connector` 계약을 만족한다.
- HTTP/Socket Mode에서 동일한 이벤트 처리 규칙을 유지한다.
- 메시지 계열 트리거(`mention`, `thread`, `channel`)는 하나의 사용자 액션당 고정된 우선순위에 따라 정확히 하나만 실행된다.
- 각 trigger와 reaction rule은 event filter를 받아, 채널/작성자/본문/ts/threadTs 같은 정보로 실행 여부를 거를 수 있다.
- 프롬프트 소스는 인라인 텍스트와 파일 참조를 모두 지원한다.

## 스펙 안정성 분류

- `Stable`
  - `conversationId` 규칙, 활성 스레드 추적, 이벤트 중복 제거 의미
  - 메시지 계열 고정 우선순위(`mention > thread > channel`)
  - `triggers` 생략 시 legacy default, `triggers` 내부 key 생략 시 비활성 규칙
  - prompt source와 filter 계약
  - ConnectorOutput과 HTTP 서명 검증 의미
- `Flexible`
  - thinking 메시지 문구, step 렌더링 표현, prompt 합성 포맷, filter event 세부 필드 확장, 캐시 세부
- `Experimental`
  - 와일드카드 reaction 매칭, 정규식 기반 채널 필터, 고급 Block Kit 확장

## 용어 정의

- `activeThreads`: 봇이 참여한 스레드를 기억하는 인메모리 집합.
- `processingEvents`: 현재 처리 중인 Slack 이벤트 dedupe 슬롯.
- `message trigger`: `mention`, `thread`, `channel` 중 Slack 메시지에서 파생되는 단일 실행 후보.
- `reaction rule`: Slack reaction name별로 연결된 prompt 또는 제어 액션.
- `prompt source`: 인라인 문자열 또는 `{ file: string }` 형태의 파일 참조.
- `trigger filter`: 정규화된 Slack event 정보를 받아 해당 trigger를 통과시킬지 결정하는 함수.
- `reaction filter event`: reacted message를 먼저 조회한 뒤, 메시지 작성자/본문/thread 정보까지 채워서 전달되는 reaction용 filter 입력.
- `ConnectorOutput`: 진행/최종 결과를 Slack에 렌더링하는 출력 객체.

## 요구사항

- `SLACK-CONN-FR-001 [Committed][Stable]`: connector는 HTTP Events API와 Socket Mode를 모두 지원해야 한다.
- `SLACK-CONN-FR-002 [Committed][Stable]`: connector는 설정된 `mention`, `thread`, `channel`, `reaction` 트리거만 처리해야 한다.
- `SLACK-CONN-FR-003 [Committed][Stable]`: 하나의 Slack 사용자 액션이 여러 메시지 트리거 후보를 만들면, connector는 고정 우선순위(`mention > thread > channel`)에 따라 하나의 액션만 실행해야 한다.
- `SLACK-CONN-FR-004 [Committed][Stable]`: 응답 출력은 진행 단계 누적, 최종 결과, 에러를 Slack 메시지로 표현해야 한다.
- `SLACK-CONN-FR-005 [Committed][Stable]`: Markdown 응답은 Slack mrkdwn/Block Kit로 변환돼야 한다.
- `SLACK-CONN-FR-006 [Committed][Stable]`: HTTP 모드에서는 Slack 서명 검증을 수행해야 한다.
- `SLACK-CONN-FR-007 [Committed][Stable]`: connector 설정은 이벤트별 프롬프트를 inline text 또는 file reference로 선언할 수 있어야 한다.
- `SLACK-CONN-FR-008 [Committed][Stable]`: reaction rule은 이모지별로 prompt 액션 또는 control 액션(`abort`)을 선언할 수 있어야 한다.
- `SLACK-CONN-FR-009 [Committed][Stable]`: `triggers` 설정이 생략되면 기존 기본 동작(mention + active thread + `:x:` abort)을 유지해야 한다.
- `SLACK-CONN-FR-010 [Committed][Stable]`: 각 trigger와 reaction rule은 optional `filter(event)`를 가질 수 있어야 한다.
- `SLACK-CONN-FR-011 [Committed][Stable]`: `triggers` 객체가 존재할 때는 key가 없는 항목을 비활성으로 해석해야 한다.
- `SLACK-CONN-FR-012 [Committed][Stable]`: reaction rule filter는 reacted message lookup 이후, 메시지 기준 정보가 채워진 event를 받아야 한다.
- `SLACK-CONN-NFR-001 [Committed][Stable]`: Slack Web API 토큰은 connector 옵션을 통해서만 사용되고 외부로 노출되지 않아야 한다.
- `SLACK-CONN-NFR-002 [Committed][Stable]`: 최상위 일반 채널 메시지 반응은 명시적으로 켜기 전까지 기본 비활성 상태여야 한다.

## 수용 기준 (AC)

- `SLACK-CONN-AC-001`: Given HTTP 또는 Socket Mode 설정이 있을 때 When connector를 등록하면 Then 둘 다 동일한 이벤트 처리 경로를 사용한다.
- `SLACK-CONN-AC-002`: Given `mention`, `thread`, `channel` 또는 configured reaction rule이 있을 때 When connector가 처리하면 Then 각 규칙에 맞는 `InboundEvent` 또는 control action이 실행된다.
- `SLACK-CONN-AC-003`: Given 하나의 메시지가 `mention`과 `thread`를 동시에 만족할 때 When connector가 처리하면 Then 고정 우선순위에 따라 `mention` 하나만 실행된다.
- `SLACK-CONN-AC-004`: Given 진행/최종/에러 출력이 필요할 때 When ConnectorOutput이 렌더링하면 Then Slack 제한 내에서 업데이트/오버플로우 처리된다.
- `SLACK-CONN-AC-005`: Given Markdown 또는 테이블이 포함된 응답이 있을 때 When 변환하면 Then Slack 호환 payload가 생성된다.
- `SLACK-CONN-AC-006`: Given HTTP 이벤트 요청이 올 때 When 서명이 올바르지 않으면 Then 요청은 거부된다.
- `SLACK-CONN-AC-007`: Given prompt가 `{ file: './prompts/slack/mention.md' }`로 설정됐을 때 When 이벤트가 발생하면 Then connector는 `config.cwd`를 우선 기준으로, 없으면 `sena.config.ts`가 있는 디렉터리를 기준으로 파일을 읽는다.
- `SLACK-CONN-AC-008`: Given reaction `eyes`와 `x`가 각각 prompt/action으로 설정됐을 때 When 두 리액션이 들어오면 Then `eyes`는 turn 제출, `x`는 abort로 각각 처리된다.
- `SLACK-CONN-AC-009`: Given `triggers` 설정이 없는 기존 connector 설정일 때 When app mention / active thread / `:x:` reaction이 들어오면 Then 현재 동작과 동일하게 처리된다.
- `SLACK-CONN-AC-010`: Given `mention.filter(event)`가 `false`를 반환할 때 When mention 후보가 생기면 Then mention은 무시되고 더 낮은 우선순위 후보가 있으면 그쪽으로 계속 평가된다.
- `SLACK-CONN-AC-011`: Given `triggers` 객체가 있고 `channel` key가 없을 때 When 최상위 일반 채널 메시지가 들어오면 Then channel trigger는 실행되지 않는다.
- `SLACK-CONN-AC-012`: Given reaction filter가 `event.text` 또는 `event.threadTs`를 읽을 때 When reaction이 들어오면 Then reacted message 조회 뒤 채워진 값이 전달된다.
- `SLACK-CONN-AC-013`: Given reacted message가 봇 메시지일 때 When reaction filter가 실행되면 Then target author는 `messageBotId`로 전달된다.

## 의존관계 맵

- Depends On: `@sena-ai/core`, Slack Web API, Slack Socket Mode
- Blocks: Slack 직접 통합 에이전트
- Parallelizable With: `tools-slack`

## 범위 경계 (Non-goals)

- 플랫폼 기반 relay 경로는 이 패키지가 아닌 `platform-connector` 책임이다.
- Slack 외 채팅 채널은 다루지 않는다.
- 이번 스펙은 prompt templating DSL, reaction wildcard, DB 기반 trigger persistence까지 포함하지 않는다.

## 제약 & 가정

- connector는 봇 토큰을 직접 보유한다.
- 스레드 활성 상태는 인메모리 기반이며 재시작 후 히스토리 조회로 일부 복구한다.
- prompt file reference는 UTF-8 텍스트 파일을 전제로 하며, 상대 경로는 `config.cwd`를 우선 기준으로, 없으면 `sena.config.ts` 파일이 있는 디렉터리 기준으로 해석한다.
- filter는 `false`를 반환하면 해당 candidate/rule을 무시하고, `true` 또는 `undefined`를 반환하면 통과로 본다.

## 리스크 & 완화책

- `Risk`: Slack이 동일 사용자 액션에 `app_mention`과 `message`를 둘 다 보내 dedupe가 실패할 수 있다.
  - `완화`: processing/processed 이중 슬롯과 고정 trigger 우선순위를 함께 유지한다.
- `Risk`: 채널 메시지 trigger를 잘못 켜면 불필요한 턴이 폭증할 수 있다.
  - `완화`: channel trigger 기본 비활성 + explicit opt-in 제약을 둔다.
- `Risk`: prompt file 경로 오타가 런타임에 조용히 빈 prompt로 폴백될 수 있다.
  - `완화`: 파일 읽기 실패 시 해당 액션을 명시적으로 실패 처리하고 로그를 남긴다.
- `Risk`: filter 예외가 나면 예상 못 한 하위 trigger가 실행될 수 있다.
  - `완화`: filter throw/reject는 전체 candidate 평가를 중단하고 이벤트를 drop한다.
- `Risk`: 부분 `triggers` 설정을 넣는 순간 기존 thread/`:x:` 동작이 함께 꺼질 수 있다.
  - `완화`: legacy default는 `triggers` 생략에서만 적용된다고 문서화하고, 부분 설정 예시에 필요한 key를 함께 적는다.
- `Risk`: reaction filter가 target message 조회 없이 실행되면 구현마다 `text/threadTs` 의미가 달라질 수 있다.
  - `완화`: reaction filter는 lookup 이후의 보강된 event를 받도록 계약을 고정한다.
- `Risk`: 봇이 쓴 Slack 메시지에 달린 reaction이 사람 메시지와 같은 작성자 계약을 강제받으면 기본 `:x:` 취소도 깨질 수 있다.
  - `완화`: reaction target author는 `messageUserId` 또는 `messageBotId`로 표현하고, `threadTs`는 lookup 뒤 항상 채운다.
- `Risk`: Slack 메시지 제한을 넘으면 진행 출력이 깨질 수 있다.
  - `완화`: step 오버플로우 분리와 truncate 규칙을 문서화한다.

## 검증 계획

- `verify.test.ts`로 서명 검증
- `mrkdwn.test.ts`로 Markdown/table 변환
- `config/trigger` 단위 테스트로 고정 우선순위, omit=disabled, prompt source, filter, reaction rule 해석 검증
- reaction lookup 테스트로 filter 입력의 `text`, `threadTs`, `messageUserId/messageBotId` 채움 여부 검증
- 수동 smoke test로 Slack 이벤트, 출력, 파일 다운로드, 취소 흐름 검증

## 상세 스펙

- [connector.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/connector.md)
- [configuration.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/configuration.md)
- [events.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/events.md)
- [output.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/output.md)
- [mrkdwn.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/mrkdwn.md)
- [verify.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/verify.md)

## 개편 메모

- Slack connector 설정 스펙을 trigger 중심으로 확장하고, omit=disabled, 고정 우선순위, filter, prompt source 계약을 분리했다.
