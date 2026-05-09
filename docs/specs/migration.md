# Migration

## 한 줄

**0. PoC 0단계 (조합 검증)** → 1~8. 본 에이전트 순차 마이그(sena_v2 또는 신규 PoC → 본 sena → 브렌 → lumie → sooki).

## 0. PoC 0단계 — 조합 검증

차니 시그널: *"ai-sdk + chat-sdk + codex / claude-code adapter 이 조합에서 어떻게 작동할지 보고 생각해줘"* (2026-05-10).

본 마이그(§1~8) 진입 전에 **단일 베어본 에이전트**로 SPEC §"확정된 결정"의 미지수를 한 번에 닫는다.

### 0단계 범위

- 새 디렉토리 `~/agents/sena-poc/` 생성. `@sena-ai/app` 빈 패키지로 시작.
- 의존: `ai`, `chat`, `@chat-adapter/slack`, `@chat-adapter/state-pg`, `ai-sdk-provider-claude-code`(또는 `codex-cli`).
- 1개 Slack 채널(예: `#z_log-poc` 신설)에 mention turn 한 발이 끝까지 도는 것까지가 0단계 종료점.

### 0단계가 닫는 미지수 (체크리스트)

| 미지수                                                    | 0단계 검증 방법                                                              | 결과 반영 위치                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- |
| ai-sdk `LanguageModelV3Middleware` hook 가능 지점         | `transformParams`로 system 합성, `wrapStream`으로 chunk trace 둘 다 시도         | `docs/specs/hooks.md` rev. 2  |
| chat-sdk 핸들러 hook 가능 지점                            | `onNewMention` 외 message / reaction / button / slash / modal 핸들러 직접 호출 | `docs/specs/connectors/slack.md` rev. 2 |
| `ScheduledMessage`가 cronSchedule 흡수                     | 단순 cron 한 발 등록해 trigger turn 동작 확인                                    | `docs/specs/schedules.md` rev. 2 |
| `@chat-adapter/slack` 출력 디테일 커버 범위                | mrkdwn(꺾쇠/볼드) / unfurl(URL 자동 preview) / streaming preview / table block 한 turn에 모두 통과 | 미커버 항목 wiki(별도)          |
| Zod inline tool 흡수 여부                                  | `defineTool()` 한 개 등록 후 turn 안에서 호출 시도                              | `docs/specs/tools.md` rev. 2  |
| chat-sdk observability 범위                                | 핸들러 trace API 노출 여부 + chunk 단위 추적이 어느 레이어에서 가능한지         | `SPEC.md` NFR-4 결정 입력     |
| `@chat-adapter/state-pg` 실 동작                          | 로컬 PG 띄워서 등록 → 재시작 후 conversation history 복원 확인                  | 확정 결정 #2 검증              |
| 프로세스 구조 결정 입력                                    | 단일 프로세스에서 hot-reload / 다중 connector / cron 발화 / restart 충돌 여부   | 확정 결정 #3 입력              |

### 0단계 결과물

- `~/agents/sena-poc/` 동작 코드.
- **0단계 보고서** — `reports.yechanny.workers.dev/sena-v3-poc-report/`(예정). 위 체크리스트 결과 + SPEC rev. 2 반영안 + 확정 결정 #3 차니 결정 권고.
- 보고 후 차니 confirm → SPEC rev. 2 → 본 마이그 §1 시작.

## 마이그 단위 절차

각 에이전트 1개당:

1. **새 디렉토리 준비** — 기존 `~/agents/{name}/` 옆에 `~/agents/{name}-v3/` 또는 별도 브랜치. 1차에서는 두 버전이 공존할 수 있게 두고, 안정화 후 swap.
2. **`sena.config.ts` v3 인터페이스로 다시 작성** — `docs/specs/config.md` §"1차 가설" 그대로. 기존 v2 설정의 의도를 한 항목씩 매핑.
3. **hook 코드 마이그** — v2의 `TurnStartHook` / `TurnEndCallback` / 사용자 `reviewGate` 등을 ai-sdk middleware로 다시 짠다 (`docs/specs/hooks.md` §"v2 hook → v3 middleware 매핑").
4. **`.sessions.json` 폐기** — chat-sdk state adapter로 교체 (`docs/specs/connectors/slack.md` §State).
5. **MCP / inline tool 정리** — `defineTool()` 코드는 inline MCP 서버 또는 chat-sdk·ai-sdk 흡수 경로로 (`docs/specs/tools.md`).
6. **24시간 라이브 운영** — 멘션 / 스레드 / cron / reaction abort / 채널 컨텍스트 합성을 모두 한 번 이상 통과시켜 회귀 항목 점검.
7. **회귀 항목 패치** — Slack 디테일 미커버 발견 시 wrapper 또는 upstream PR. 자체 코드 수정은 *마지막 수단*.
8. **v2 의존성 제거** — `@sena-ai/*` 의존을 모두 떼고, 기존 `~/agents/{name}/`의 v2 프로세스 중지.

## v2 hook → v3 middleware 매핑 (체크리스트)

| v2 코드 위치                          | v3 옮길 곳                                  | 비고                                                         |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `hooks/channelContext.ts`             | `middlewares: [channelContext()]`           | `transformParams`에서 system 합성. `docs/specs/channels.md`. |
| `hooks/sunnySystemHook.ts`            | (v3 1차 범위 외)                           | Sunny adapter는 v3 1차에서 빼기로. PRD §7.                   |
| `hooks/traceLogger.ts`                | `middlewares: [traceLogger()]`              | `wrapStream`에서 chunk 단위 관찰.                            |
| `hooks/reviewGate.ts` (브렌)          | middleware로 다시 짬                        | 시그니처 변경 가능. PoC에서 형태 결정.                       |
| `cronSchedule()` / `heartbeat()`      | `schedules: [cronSchedule({...})]`          | `heartbeat`는 별도 API 폐기, cron으로 통합. `docs/specs/schedules.md`. |
| `defineTool()` (Zod 인라인 도구)      | inline MCP 서버 우회 또는 chat-sdk·ai-sdk 자체 메커니즘 | `docs/specs/tools.md`.                                       |
| `restart_agent` (worker 내부 도구)    | 프로세스 구조 결정에 의존                    | 차니 §11.3 결정 후 별도 다룸.                               |

## 잃는 것 (PRD §9 그대로)

- claude-code provider Zod tool 미지원 → MCP 우회.
- claude-code provider reasoningEffort 미지원 → cc 시스템 설정 위임 (옵션이 noop).
- codex-cli provider 모델명 사전 정의 → 신규 모델은 provider upstream PR.
- chat-sdk Slack 어댑터 디테일 커버 범위 미지 → 마이그 1차 직후 전수조사.

## 일정 (PRD §10 + 0단계 추가)

- **5/10** SPEC rev. 1 (확정 결정 4개 반영) — 완료.
- **5/11 ~ 5/13** **0단계 PoC** (위 §0). 차니 confirm 후 SPEC rev. 2.
- **5/14 ~ 5/20** 베어본 + sena_v2 또는 신규 PoC 에이전트 1개 본 마이그.
- **5/21 ~ 5/27** Slack 디테일 전수조사 + 미커버 항목 패치.
- **5/28 ~ 6/10** 본 에이전트 순차 마이그 (sena → 브렌 → lumie → sooki).
- **6/11 ~ 6/24** v2 deprecation, 6주 측정 시작.

## v2 deprecation

4 에이전트 모두 v3 위에서 24h 안정화한 다음:
- v2 프로세스(`sena restart` SIGUSR2 기반) 영구 중단.
- `@sena-ai/*` 패키지의 npm `latest` 태그 freeze (deprecate 메시지 추가).
- v2 `Variel/sena` 리포는 archive 표시.
- 모노레포 history 보존 / orphan reset 결정은 차니 §11.5 확정 후.

## AC

1. 1차 PoC 에이전트가 24시간 라이브 운영 중 v2 동등 기능을 100% 통과한다 (멘션 응답 / streaming / unfurl / reaction abort / cron / channel context).
2. 4 에이전트 마이그 후 6주 동안 #project-sena 채널의 디버그 항목이 v2 직전 6주 대비 절반 이하 (PRD `S-2`).
3. 외부 빌더 1명이 v3 README와 PoC 디렉토리만 보고 새 에이전트를 띄울 수 있다 (PRD `S-4`).
