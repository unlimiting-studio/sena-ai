# Plan: 2026-05-10 Spec re-align + 아키텍처 보고서

## 한 줄

§1 step 3~4.7 동안 코드는 갱신됐는데 스펙 7곳이 따라오지 않았다. 코드와 일치하도록 갱신하고, 동시에 *외부 사람이 봐도 v3 가 어떻게 돌아가는지* 알 수 있는 아키텍처/코드베이스 보고서를 만든다.

## 문제(니즈)와 현 상태

차니: "지금 상황이 어떻게 돌아가고 있는지 모르겠어" → 진행 보고는 만들었음 (`/sena-v3-step1-progress/`). 그 후 *스펙 갱신* + *시스템 정적 그림* 두 갈래 요청:

1. **불일치 있는거 싹 다 잡아서 고쳐** — `docs/specs/` 7곳에 코드-스펙 갭. 1순위 두 곳(`schedules.md`, `migration.md`) 은 정면 모순이라 운영 위험.
2. **지금까지의 아키텍처랑, 우리쪽 코드베이스가 하는 역할도 보고서 만들어줘** — `@sena-ai/app` 의 구조 + 외부 의존(ai-sdk, chat-sdk, state-pg, Slack 어댑터) + starter 인터페이스 + 운영 흐름.

## 솔루션 (목표)

### 스펙 갱신 (정면 모순 + 누락 + 정합성)

| 그룹 | 파일 | 변경 |
|---|---|---|
| A1 | `docs/specs/schedules.md` | `ScheduleTarget` union 좁힘 (`conversation` 제거) + threadTs 있/없음 분기 + step 4.5 history-aware 롤백 결정 + visible user-like post 거부 → step 5+ 미루기 |
| A2 | `docs/specs/migration.md` | step 3~4.7 진척 기록 + 부수 발견 #4 (5/10 `silenceStreamTextRejections`) + #5 (lily subscription leak) 등재 |
| B1 | `docs/specs/config.md` | factory wrapper (`slackAdapter`, `postgresState`, `requiredEnv`, `createMemoryState`) 시그니처 + `traceLogger({ label })` + `channelContext.optional` + `MemoryStateConfig`/`PostgresStateConfig` 객체 폼 |
| B2 | `docs/specs/architecture.md` | `run()` 통합 entry 흐름 + `templates/slack-agent/` starter 패턴 + `runtime/turn-context.ts` AsyncLocalStorage 절 |
| B3 | `docs/specs/tools.md` | `config.tools` (ToolSet) + `maxSteps` + `stopWhen: stepCountIs` (step 4.6 cbc0208) |
| B4 | `docs/specs/hooks.md` | turn-context AsyncLocalStorage 패턴 (channelContext 가 channelId 받는 구조) |
| C1 | `docs/specs/connectors/slack.md` | drain skip 안내 + `triggers.filter(event)` step 5+ 미루기 명시 |

### 아키텍처 보고서 (D)

`reports.yechanny.workers.dev/sena-v3-architecture/` 신규 페이지. 외부 빌더 / 차니 본인이 한 페이지로 v3 전체 그림 잡을 수 있게.

내용:
1. 한 줄 thesis ("`run(defineConfig({...}))` 한 줄로 lily 같은 봇이 도는 얇은 앱 레이어")
2. 의존 스택 다이어그램 (chat-sdk · ai-sdk · state-pg · @chat-adapter/slack · claude-code provider)
3. `@sena-ai/app` 패키지가 하는 5 역할:
   - 통합 entry (`run()`)
   - 핸들러 3종 (queue / steering / step-steering)
   - drain wrapper / steering 레이어
   - schedules fan-out
   - factory wrapper (slack/postgres/env)
4. starter 패턴 (`templates/slack-agent/`)
5. 운영 흐름 (mention → handler → middleware → streamText → post)
6. 라이브 운영 상태 (sena-bare PID 59351, lily 봇)

## 비목표 (하면 안되는 것)

- 코드 자체 변경 ❌ — 이번 작업은 *스펙을 코드에 맞춤*. 코드는 손대지 않음.
- step 5+ 영역 진입 ❌ — 미구현 항목은 *명시적으로 미룸* 으로 기록만, 구현 시도 ❌.
- 새 패키지 / 새 의존성 ❌.

## 비목표 (앞으로 할 수도 있지만 범위 밖)

- ai-sdk 내부 unhandled rejection root fix → step 5+
- Slack `triggers.filter(event)` 정식 구현 → step 5+
- `conversation` ScheduleTarget type 부활 (chat-sdk Conversation id 매핑 닫힌 후) → step 5+
- `@sena-ai/app@0.1.0` npm publish → 차니 별도 sign-off 필요

## 확정된 주요 의사결정 사항

- 차니 정책 "🚫 폴백/바이패스 금지" + "codex fallback 추가 = guard 로 번역" 그대로 유지.
- step 4.5 history-aware 롤백 결정 (outbound 만으로 차니 우려 충족) 그대로 보존 — 스펙에 *명시적으로* 기록.
- 각 미구현 항목은 *step 5+ 로 미루기* 라고 시점/이유 명시.

## 상세 실행 계획

작업 4 그룹을 **병렬 dispatch** (서로 의존 없음).

### 그룹 A — 스펙 1순위 (정면 모순 fix)
- 한 매니저가 A1 + A2 동시 처리 (한 PR)
- 입력: 코드 (`packages/app/src/schedules/cron.ts`, `runtime/scheduleFanOut.ts`, `runtime/run.ts`), commit history (step 1~4.7), 채널 메모리
- 출력: `schedules.md` rev. 3 + `migration.md` rev. 3

### 그룹 B — 스펙 2순위 (누락 보강)
- 한 매니저가 B1 + B2 + B3 + B4 동시 처리
- 입력: 코드 (`packages/app/src/`, `templates/slack-agent/`)
- 출력: 4 파일 갱신

### 그룹 C — 스펙 3순위 (정합성)
- 한 매니저가 C1 처리
- 입력: 코드 (`packages/app/src/runtime/handlers/types.ts` 의 drain skip 안내) + Slack connector spec 4/4 박은 trigger filter
- 출력: `connectors/slack.md` 갱신

### 그룹 D — 아키텍처 보고서
- 한 매니저가 새 보고서 페이지 작성
- 입력: 현재 코드 상태 + step 1~4.7 진행 보고 (이미 작성됨, `/sena-v3-step1-progress/`)
- 출력: `reports/public/sena-v3-architecture/index.html` + `reports/public/index.html` 카드 추가
- 배포: `cd ~/workspace/repos/reports && pnpm run deploy`

## 상세 검증 계획

1. **각 그룹 결과 핑퐁 검증** — 매니저 보고 후 핵심 항목 sample 검증 (직접 grep / 코드 cross-link)
2. **codex review 1 라운드** — 그룹 A+B+C 통합 후 sena-v3 v3 브랜치에 codex 리뷰
3. **링크 무결성** — 모든 docs 내부 링크가 존재 파일/섹션 가리키는지
4. **아키텍처 보고서 라이브 fetch** — 배포 후 `curl https://reports.yechanny.workers.dev/sena-v3-architecture/` 200
5. **최종 commit + push** — 그룹 A+B+C 한 PR (전수조사 = 한 PR 정책), D 는 reports 리포 별도 commit
6. **차니 보고** — 두 commit/URL 한 메시지에
