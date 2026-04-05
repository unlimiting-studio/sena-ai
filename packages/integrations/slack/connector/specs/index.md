# @sena-ai/connector-slack

## 한 줄 요약

Slack 이벤트를 sena-ai `InboundEvent`로 바꾸고, 에이전트 응답을 Slack 메시지로 반영하는 코어 `Connector` 구현이다.

## 문제 정의

- Slack은 HTTP Events API와 Socket Mode라는 두 입력 경로를 제공하고, 하나의 사용자 액션에 대해 `app_mention`, `message`, `reaction_added`가 겹쳐 관찰될 수 있다.
- 기존 connector는 멘션/활성 스레드/`:x:` 취소가 하드코딩돼 있어, 채널 메시지 반응이나 DM 전용 프롬프트, 리액션별 프롬프트 같은 운영 정책을 설정으로 선언하기 어렵다.
- 프롬프트를 인라인 문자열로만 두면 재사용과 유지보수가 불편하고, 이벤트별 행동 차이를 문서와 코드가 함께 추적하기 어렵다.
- 이벤트 발생 직후 무시 여부를 세밀하게 결정할 표면이 없어, 채널/작성자/본문 기준 예외 처리를 선언형으로 쓰기 어렵다.
- Slack 응답 Markdown 변환 로직이 connector와 tools에 중복되어 있으면 safe mode 규칙과 예외 케이스가 드리프트하기 쉽다.

## 목표 & 성공 지표

- Slack connector가 코어 `Connector` 계약을 만족한다.
- HTTP/Socket Mode에서 동일한 이벤트 처리 규칙을 유지한다.
- 메시지 계열 트리거(`mention`, `thread`, `directMessage`, `channel`, `message`)는 하나의 사용자 액션당 고정된 우선순위에 따라 정확히 하나만 실행된다.
- 각 trigger와 reaction rule은 event filter를 받아, 채널/작성자/본문/ts/threadTs 같은 정보로 실행 여부를 거를 수 있다.
- 프롬프트 소스는 인라인 텍스트와 파일 참조를 모두 지원한다.
- Slack 출력 Markdown 변환은 기본 safe mode를 사용하고, connector와 tools가 동일한 공용 변환 계약을 공유한다.

## 스펙 안정성 분류

- `Stable`
  - `conversationId` 규칙, 활성 스레드 추적, 이벤트 중복 제거 의미
  - 메시지 계열 고정 우선순위(`mention > thread > directMessage > channel > message`)
  - `triggers` 생략 시 legacy default, `triggers` 내부 key 생략 시 비활성 규칙
  - prompt source와 filter 계약
  - ConnectorOutput과 HTTP 서명 검증 의미
- `Flexible`
  - thinking 메시지 문구, step 렌더링 표현, prompt 합성 포맷, filter event 세부 필드 확장, 캐시 세부
- `Experimental`
  - 와일드카드 reaction 매칭, 정규식 기반 채널 필터, safe mode를 깨지 않는 범위의 고급 Block Kit 확장

## 용어 정의

- `activeThreads`: 봇이 참여한 스레드를 기억하는 인메모리 집합.
- `processingEvents`: 현재 처리 중인 Slack 이벤트 dedupe 슬롯.
- `message trigger`: `mention`, `thread`, `directMessage`, `channel`, `message` 중 Slack 메시지에서 파생되는 단일 실행 후보.
- `directMessage (trigger kind)`: Slack 1:1 DM 채널(`channel_type = 'im'`, fallback으로 channel id prefix `D`) 메시지에 반응하는 전용 트리거. `thread`보다 낮고 `message`보다 높은 우선순위를 갖는다.
- `message (trigger kind)`: 채널 메시지든 쓰레드 메시지(봇 참여 여부 무관)든 반응하는 범용 트리거. 가장 낮은 우선순위. `thread` key가 활성이면 봇 참여 스레드는 `thread`가 우선 처리하므로 중복 없음.
- `reaction rule`: Slack reaction name별로 연결된 prompt 또는 제어 액션.
- `prompt source`: 인라인 문자열 또는 `{ file: string }` 형태의 파일 참조.
- `trigger filter`: 정규화된 Slack event 정보를 받아 해당 trigger를 통과시킬지 결정하는 함수.
- `trigger function`: trigger 필드에 직접 할당하는 함수. filter와 유사하나, 반환값으로 prompt source와 설정을 동적으로 override할 수 있다.
- `reaction filter event`: reacted message를 먼저 조회한 뒤, 메시지 작성자/본문/thread 정보까지 채워서 전달되는 reaction용 filter 입력.
- `ConnectorOutput`: 진행/최종 결과를 Slack에 렌더링하는 출력 객체.

## 요구사항

- `SLACK-CONN-FR-001 [Committed][Stable]`: connector는 HTTP Events API와 Socket Mode를 모두 지원해야 한다.
- `SLACK-CONN-FR-002 [Committed][Stable]`: connector는 설정된 `mention`, `thread`, `directMessage`, `channel`, `message`, `reaction` 트리거만 처리해야 한다.
- `SLACK-CONN-FR-003 [Committed][Stable]`: 하나의 Slack 사용자 액션이 여러 메시지 트리거 후보를 만들면, connector는 고정 우선순위(`mention > thread > directMessage > channel > message`)에 따라 하나의 액션만 실행해야 한다.
- `SLACK-CONN-FR-004 [Committed][Stable]`: 응답 출력은 진행 단계 누적, 최종 결과, 에러를 Slack 메시지로 표현해야 한다.
- `SLACK-CONN-FR-005 [Committed][Stable]`: Markdown 응답은 Slack safe mrkdwn/Block Kit payload로 변환돼야 한다. 기본 렌더링은 auto parsing에 의존하지 않고, 링크/멘션/채널/유저그룹/특수 mention은 명시적 Slack 토큰 표기만 허용한다.
- `SLACK-CONN-FR-006 [Committed][Stable]`: HTTP 모드에서는 Slack 서명 검증을 수행해야 한다.
- `SLACK-CONN-FR-007 [Committed][Stable]`: connector 설정은 이벤트별 프롬프트를 inline text 또는 file reference로 선언할 수 있어야 한다.
- `SLACK-CONN-FR-008 [Committed][Stable]`: reaction rule은 이모지별로 prompt 액션 또는 control 액션(`abort`)을 선언할 수 있어야 한다.
- `SLACK-CONN-FR-009 [Committed][Stable]`: `triggers` 설정이 생략되면 기존 기본 동작(mention + active thread + `:x:` abort)을 유지해야 한다.
- `SLACK-CONN-FR-010 [Committed][Stable]`: object 형태의 trigger와 reaction rule은 optional `filter(event)`를 가질 수 있어야 한다. 함수형 trigger(FR-015)는 function 자체가 filter와 prompt source 결정을 겸하므로 별도 `filter` 필드를 갖지 않는다.
- `SLACK-CONN-FR-011 [Committed][Stable]`: `triggers` 객체가 존재할 때는 key가 없는 항목을 비활성으로 해석해야 한다.
- `SLACK-CONN-FR-012 [Committed][Stable]`: reaction rule filter는 reacted message lookup 이후, 메시지 기준 정보가 채워진 event를 받아야 한다.
- `SLACK-CONN-NFR-001 [Committed][Stable]`: Slack Web API 토큰은 connector 옵션을 통해서만 사용되고 외부로 노출되지 않아야 한다.
- `SLACK-CONN-FR-013 [Committed][Stable]`: 각 trigger와 reaction rule은 optional `thinkingMessage`를 가질 수 있어야 한다. trigger-level 설정은 전역 `thinkingMessage`보다 우선하며, `false`이면 해당 trigger에서 thinking message를 사용하지 않는다.
- `SLACK-CONN-FR-014 [Committed][Stable]`: `message` 트리거는 채널 메시지와 쓰레드 메시지(봇 참여 여부 무관)에 모두 반응하는 범용 트리거이며, 가장 낮은 우선순위를 갖는다. `thread` key가 활성이면 봇 참여 스레드는 우선순위에서 `thread`가 먼저 선택되므로 중복 실행은 없다.
- `SLACK-CONN-FR-015 [Committed][Stable]`: 메시지 계열 trigger 필드와 reaction rule 필드 모두 function을 직접 받을 수 있어야 한다. function은 event를 인자로 받아, 반환값으로 prompt source와 설정(`thinkingMessage` 등)을 동적으로 결정한다. reaction function은 추가로 `{ abort: true }`를 반환하여 abort action을 수행할 수 있다. `false`/`undefined`/`void` 반환 시 해당 trigger/rule을 건너뛴다.
- `SLACK-CONN-FR-016 [Committed][Stable]`: `directMessage` 트리거는 Slack 1:1 DM 채널(`channel_type = 'im'`, fallback으로 channel id prefix `D`) 메시지에만 반응해야 하며, `thread`보다 낮고 `channel` 및 `message`보다 높은 우선순위를 가져야 한다.
- `SLACK-CONN-FR-017 [Committed][Stable]`: connector의 Markdown 변환은 `tools-slack`과 공유하는 공용 Slack Markdown 패키지 계약을 사용해야 한다.
- `SLACK-CONN-NFR-002 [Committed][Stable]`: 최상위 일반 채널 메시지와 Slack direct message 반응은 `channel`, `directMessage`, `message` key를 명시적으로 켜기 전까지 기본 비활성 상태여야 한다.

## 수용 기준 (AC)

- `SLACK-CONN-AC-001`: Given HTTP 또는 Socket Mode 설정이 있을 때 When connector를 등록하면 Then 둘 다 동일한 이벤트 처리 경로를 사용한다.
- `SLACK-CONN-AC-002`: Given `mention`, `thread`, `directMessage`, `channel`, `message` 또는 configured reaction rule이 있을 때 When connector가 처리하면 Then 각 규칙에 맞는 `InboundEvent` 또는 control action이 실행된다.
- `SLACK-CONN-AC-003`: Given 하나의 메시지가 여러 메시지 trigger를 동시에 만족할 때 When connector가 처리하면 Then 고정 우선순위(`mention > thread > directMessage > channel > message`)에 따라 가장 높은 우선순위 하나만 실행된다.
- `SLACK-CONN-AC-004`: Given 진행/최종/에러 출력이 필요할 때 When ConnectorOutput이 렌더링하면 Then Slack 제한 내에서 업데이트/오버플로우 처리된다.
- `SLACK-CONN-AC-005`: Given Markdown 또는 테이블이 포함된 응답이 있을 때 When 변환하면 Then Slack safe mode payload가 생성되고, mrkdwn text object는 auto parsing 없이 렌더링되며, 명시적 Slack 토큰만 링크/멘션/채널로 해석된다.
- `SLACK-CONN-AC-006`: Given HTTP 이벤트 요청이 올 때 When 서명이 올바르지 않으면 Then 요청은 거부된다.
- `SLACK-CONN-AC-007`: Given prompt가 `{ file: './prompts/slack/mention.md' }`로 설정됐을 때 When 이벤트가 발생하면 Then connector는 `config.cwd`를 우선 기준으로, 없으면 `sena.config.ts`가 있는 디렉터리를 기준으로 파일을 읽는다.
- `SLACK-CONN-AC-008`: Given reaction `eyes`와 `x`가 각각 prompt/action으로 설정됐을 때 When 두 리액션이 들어오면 Then `eyes`는 turn 제출, `x`는 abort로 각각 처리된다.
- `SLACK-CONN-AC-009`: Given `triggers` 설정이 없는 기존 connector 설정일 때 When app mention / active thread / `:x:` reaction이 들어오면 Then 현재 동작과 동일하게 처리된다.
- `SLACK-CONN-AC-010`: Given `mention.filter(event)`가 `false`를 반환할 때 When mention 후보가 생기면 Then mention은 무시되고 더 낮은 우선순위 후보가 있으면 그쪽으로 계속 평가된다.
- `SLACK-CONN-AC-011`: Given `triggers` 객체가 있고 `channel` key가 없을 때 When 최상위 일반 채널 메시지가 들어오면 Then channel trigger는 실행되지 않는다.
- `SLACK-CONN-AC-012`: Given reaction filter가 `event.text` 또는 `event.threadTs`를 읽을 때 When reaction이 들어오면 Then reacted message 조회 뒤 채워진 값이 전달된다.
- `SLACK-CONN-AC-013`: Given reacted message가 봇 메시지일 때 When reaction filter가 실행되면 Then target author는 `messageBotId`로 전달된다.
- `SLACK-CONN-AC-014`: Given `mention: { text: '...', thinkingMessage: false }`일 때 When 멘션 이벤트가 들어오면 Then 전역 `thinkingMessage`와 무관하게 thinking message가 전송되지 않는다.
- `SLACK-CONN-AC-015`: Given `mention: { text: '...', thinkingMessage: '분석 중...' }`일 때 When 멘션 이벤트가 들어오면 Then 전역 설정 대신 '분석 중...'이 thinking message로 전송된다.
- `SLACK-CONN-AC-016`: Given `message` trigger가 설정됐을 때 When 봇이 참여하지 않은 쓰레드 메시지가 들어오면 Then `message` trigger가 실행된다.
- `SLACK-CONN-AC-017`: Given `message`와 `thread` trigger가 모두 설정되고 봇이 참여한 쓰레드일 때 When 쓰레드 메시지가 들어오면 Then `thread`가 우선 실행된다.
- `SLACK-CONN-AC-018`: Given `mention: (event) => ({ file: './dynamic.md', thinkingMessage: false })`일 때 When 멘션 이벤트가 들어오면 Then function 반환값의 file을 프롬프트로 사용하고 thinking message는 전송하지 않는다.
- `SLACK-CONN-AC-019`: Given `mention: (event) => false`일 때 When 멘션 이벤트가 들어오면 Then mention은 건너뛰고 더 낮은 우선순위 후보를 계속 평가한다.
- `SLACK-CONN-AC-020`: Given `reactions.eyes: (event) => ({ abort: true })`일 때 When reaction이 달리면 Then abort가 실행된다.
- `SLACK-CONN-AC-021`: Given `directMessage` trigger가 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `directMessage` trigger가 실행된다.
- `SLACK-CONN-AC-022`: Given `directMessage`와 `message` trigger가 모두 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `directMessage`가 우선 실행된다.
- `SLACK-CONN-AC-023`: Given `channel` trigger만 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `channel` trigger는 실행되지 않는다.

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
- `Risk`: 채널 메시지 또는 DM trigger(`channel`, `directMessage`, `message`)를 잘못 켜면 불필요한 턴이 폭증할 수 있다.
  - `완화`: channel/directMessage/message trigger 기본 비활성 + explicit opt-in 제약을 둔다.
- `Risk`: trigger function 반환값 shape이 잘못되면 런타임 에러가 발생할 수 있다.
  - `완화`: 반환값 shape 검증을 이벤트 처리 시점에 수행하고, 잘못된 shape은 해당 이벤트를 실패 처리한다.
- `Risk`: prompt file 경로 오타가 런타임에 조용히 빈 prompt로 폴백될 수 있다.
  - `완화`: 파일 읽기 실패 시 해당 액션을 명시적으로 실패 처리하고 로그를 남긴다.
- `Risk`: filter 예외가 나면 예상 못 한 하위 trigger가 실행될 수 있다.
  - `완화`: filter throw/reject는 전체 candidate 평가를 중단하고 이벤트를 drop한다.
- `Risk`: `message` trigger를 켜면 봇 미참여 쓰레드에도 반응해 의도치 않은 개입이 발생할 수 있다.
  - `완화`: `message`는 가장 낮은 우선순위이므로 `thread`가 설정돼 있으면 봇 참여 스레드는 `thread`가 처리하고, `message`는 나머지만 처리한다.
- `Risk`: 부분 `triggers` 설정을 넣는 순간 기존 thread/`:x:` 동작이 함께 꺼질 수 있다.
  - `완화`: legacy default는 `triggers` 생략에서만 적용된다고 문서화하고, 부분 설정 예시에 필요한 key를 함께 적는다.
- `Risk`: reaction filter가 target message 조회 없이 실행되면 구현마다 `text/threadTs` 의미가 달라질 수 있다.
  - `완화`: reaction filter는 lookup 이후의 보강된 event를 받도록 계약을 고정한다.
- `Risk`: 봇이 쓴 Slack 메시지에 달린 reaction이 사람 메시지와 같은 작성자 계약을 강제받으면 기본 `:x:` 취소도 깨질 수 있다.
  - `완화`: reaction target author는 `messageUserId` 또는 `messageBotId`로 표현하고, `threadTs`는 lookup 뒤 항상 채운다.
- `Risk`: Slack 메시지 제한을 넘으면 진행 출력이 깨질 수 있다.
  - `완화`: step 오버플로우 분리와 truncate 규칙을 문서화한다.
- `Risk`: connector와 tools의 변환 구현이 분리돼 있으면 safe mode 회귀가 한쪽에만 반영될 수 있다.
  - `완화`: 공용 Slack Markdown 패키지와 단일 테스트 스위트로 계약을 고정한다.

## 검증 계획

- `verify.test.ts`로 서명 검증
- `mrkdwn.test.ts`로 Markdown/table 변환
- `config/trigger` 단위 테스트로 고정 우선순위, direct message opt-in, omit=disabled, prompt source, filter, reaction rule 해석 검증
- shared Slack Markdown 패키지 테스트로 safe mode, explicit Slack token 보존, table fallback, connector/tools 공용 계약을 검증
- reaction lookup 테스트로 filter 입력의 `text`, `threadTs`, `messageUserId/messageBotId` 채움 여부 검증
- 수동 smoke test로 Slack 이벤트, 출력, 파일 다운로드, 취소 흐름 검증

## 상세 스펙

- [connector.md](./connector.md)
- [configuration.md](./configuration.md)
- [events.md](./events.md)
- [output.md](./output.md)
- [mrkdwn.md](./mrkdwn.md)
- [verify.md](./verify.md)
- [../../mrkdwn/specs/index.md](../../mrkdwn/specs/index.md)

## 개편 메모

- Slack connector 설정 스펙을 trigger 중심으로 확장하고, omit=disabled, directMessage, 고정 우선순위, filter, prompt source 계약을 분리했다.
