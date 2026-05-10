# Architecture

**상태:** rev. 3 (step 4.6 cbc0208 — `run()` 통합 entry / starter 패턴 / turn-context propagation 반영).

## 한 줄

트리거(Slack · cron) → chat-sdk 어댑터 → 우리 미들웨어(channel context · trace) → ai-sdk LanguageModel → provider(claude-code / codex-cli) → 엔진(Claude Code CLI / codex CLI). **단일 Node 프로세스 + 자체 drain wrapper + AbortController 기반 steering 레이어**, 그리고 **`runtime/turn-context.ts` AsyncLocalStorage 로 trigger-time channelId/threadId 를 미들웨어까지 propagate**.

## 레이어

| 레이어               | 책임                                                                            | 누가 짠 것                  |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| 트리거               | Slack 이벤트 수신 / cron 발화 / 외부 시스템 입구                                | chat-sdk + node-cron        |
| 어댑터               | mention · thread · reaction · button · slash · modal 라우팅, 출력(streaming · mrkdwn · unfurl · table) | `@chat-adapter/slack`         |
| **우리 미들웨어**     | per-channel context 합성 · turn trace                                            | sena-ai v3 자체 코드 (얇음)   |
| **turn-context propagation** | trigger-time channelId/threadId/adapter 를 AsyncLocalStorage 로 미들웨어까지 전달 | sena-ai v3 자체 코드 (`runtime/turn-context.ts`) |
| LanguageModel 추상화 | `streamText` / `generateText` / `wrapLanguageModel`                             | `ai`                          |
| provider              | LanguageModel → Claude Code CLI / codex CLI 변환                                | `ai-sdk-provider-claude-code` / `-codex-cli` |
| 엔진                  | 실제 LLM·tool call 실행                                                         | Claude Code CLI / codex CLI   |

> **우리가 직접 짜는 코드는 "얇은 앱 레이어"** — ai-sdk middleware(channel context · trace) + 자체 schedules + drain wrapper + AbortController 기반 steering 레이어 + turn-context AsyncLocalStorage + (step 5+) 인라인 MCP 서버. 그 외(어댑터 / LanguageModel 추상 / provider / 엔진)는 외부 라이브러리에 위임.

## 통합 entry (`run()`)

step 3 ~ 4 산출물 (`packages/app/src/runtime/run.ts`). `sena.config.ts` 한 파일 + `run(defineConfig({...}))` 한 번 호출이면 베어본 에이전트가 동작한다 (PoC `~/agents/sena-poc/src/index.ts` 의 모든 인프라를 통합).

**`run(config: SenaConfig, options: RunOptions = {}): Promise<RunningApp>`** 한 함수가 다음 8 단계를 순서대로 합성한다.

| 순서 | 단계 | 책임 |
| ---: | --- | --- |
| 0 | fail-fast | `mcpServers` 가 들어있으면 throw (step 5+ 미구현). `adapters: []` 도 throw. |
| 1 | concurrency 결정 | `steerMode === 'queue'` → `{ strategy: 'queue', maxQueueSize: 10 }`, 그 외 → `{ strategy: 'concurrent', maxConcurrent? }`. |
| 2 | middleware 합성 | `config.middlewares.length > 0` 이면 `wrapLanguageModel({ model, middleware })`, 비어있으면 raw model 그대로. |
| 3 | adapters 정규화 | `Adapter[]` → `Record<name, Adapter>`. 이름 중복 시 throw. |
| 4 | Chat 인스턴스화 | `new Chat({ userName, state: resolveStateAdapter(config.state), concurrency, adapters, logger: 'info' })`. |
| 5 | drain + steering 인프라 | `createDrainController({ timeoutMs, log })` + `new SteeringRegistry()`. handler 의존성 컨테이너 `HandlerDeps = { model, tools, maxSteps: maxSteps ?? 5, drain, steering, log }` 구성. |
| 6 | handler 등록 | `steerMode` 에 따라 `createQueueHandler` / `createSteeringHandler` / `createStepSteeringHandler` 선택. 두 chat-sdk 콜백(`onNewMention`, `onSubscribedMessage`) 모두 `drain.track` 으로 감싸고, 핸들러 본문은 `runWithTurnContext({ adapter, channelId, threadId, trigger }, () => handler(...))` 로 진입. |
| 7 | `chat.initialize()` | 어댑터 connect, state schema 생성. |
| 7.5 | schedule fan-out | `config.schedules` 가 있으면 `setupScheduleFanOut(...)`. 등록 도중 throw 시 `chat.shutdown` rollback 후 다시 throw. |
| 8 | signal handler | `autoRegisterSignalHandlers !== false` 일 때 `SIGTERM`/`SIGINT` 리스너 자동 등록. **`process.exit` 은 호출하지 않는다** — drain + steering 정리까지만. 호출자가 라이브러리 임베드 환경(테스트, 핫리로드, 메인 앱) 일 수 있어서 종료 시점은 호출자 책임. |

`run()` 의 반환값 `RunningApp = { chat, drain, steering, shutdown() }`. `shutdown()` 은 한 번만 실행되도록 promise share + auto-registered signal listener 를 명시적으로 해제한다.

### `RunOptions` (코드 기준)

| 옵션                          | 기본값       | 역할                                                                                            |
| ----------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `drainTimeoutMs`              | `60_000`     | SIGTERM 받았을 때 in-flight turn 드레인 timeout.                                                 |
| `log`                         | `console.log`| drain/handler 진행 상황 로깅.                                                                    |
| `steerMode`                   | `'steering'` | `'queue'` / `'steering'` / `'step-steering'` (`docs/specs/connectors/slack.md` 참조).            |
| `userName`                    | `'sena'`     | chat-sdk `Chat` 의 `userName`.                                                                  |
| `autoRegisterSignalHandlers`  | `true`       | `SIGTERM`/`SIGINT` 리스너 자동 등록. drain 까지만 호출 (`process.exit` 미수행).                  |
| `maxConcurrentPerThread`      | (미설정 — chat-sdk 기본값 Infinity) | concurrent 모드의 thread 당 chat-sdk 동시 핸들러 상한. 너무 낮으면 steering semantics 깨짐. |

## starter 패턴 (`templates/slack-agent/`)

step 4.6 cbc0208 — FR-S-4 (외부 빌더가 한 화면에서 시작) 검증용 템플릿.

`templates/slack-agent/src/index.ts` 한 파일이 v3 의 "정식 빌더 진입점" 모양이다.

```ts
import { defineConfig, requiredEnv, run } from "@sena-ai/app";
import { slackAdapter } from "@sena-ai/app/adapters/slack";
import { channelContext, traceLogger } from "@sena-ai/app/middlewares";
import { cronSchedule } from "@sena-ai/app/schedules";
import { postgresState } from "@sena-ai/app/state";
import { claudeCode } from "ai-sdk-provider-claude-code";

const config = defineConfig({
  cwd: import.meta.dirname,
  model: claudeCode("sonnet"),
  adapters: [slackAdapter({
    appToken: requiredEnv("SLACK_APP_TOKEN"),
    botToken: requiredEnv("SLACK_BOT_TOKEN"),
  })],
  middlewares: [
    channelContext({ cwd: import.meta.dirname, channelsFile: ".sena/channels.json", memoryDir: ".sena/channels" }),
    traceLogger({ label: "sena" }),
  ],
  schedules: [cronSchedule({ name: "morning-briefing", cron: "0 8 * * *", target: { type: "slack-channel", id: "C0YOURCHANNEL" }, prompt: { file: ".sena/prompts/morning-briefing.md" } })],
  state: postgresState({ connectionString: requiredEnv("DATABASE_URL") }),
});

const app = await run(config, { steerMode: "steering" });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.shutdown().then(() => process.exit(0));
  });
}
```

starter 트리는 동작하는 최소 .sena 자료까지 포함한다:

- `templates/slack-agent/.env.example` — `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `DATABASE_URL`.
- `templates/slack-agent/.sena/channels.json` — 1 channel sample.
- `templates/slack-agent/.sena/channels/C0YOURCHANNEL/memory.md` — channel memory sample.
- `templates/slack-agent/.sena/prompts/morning-briefing.md` — cron prompt sample.

starter 의 의도:

- `defineConfig` + `run` + factory wrapper (`slackAdapter`, `postgresState`, `requiredEnv`, `channelContext`, `traceLogger`, `cronSchedule`) 만으로 한 화면 안에서 운영 가능한 봇이 만들어진다.
- `process.once("SIGTERM" | "SIGINT", ...)` 으로 호출자가 명시적으로 `app.shutdown()` 후 `process.exit(0)` 를 한다 — `RunOptions.autoRegisterSignalHandlers` 가 자동 등록한 핸들러는 drain 까지만 책임지므로, starter 처럼 임베드되지 않은 standalone 프로세스는 한 번 더 등록해서 종료까지 책임진다.

## turn-context propagation (`runtime/turn-context.ts`)

step 4.6 cbc0208 — middleware 가 trigger-time channelId/threadId 를 알기 위한 AsyncLocalStorage 패턴. `docs/specs/hooks.md` "turn-context propagation" 절과 cross-link.

```ts
const storage = new AsyncLocalStorage<SenaTurnContext>();

export interface SenaTurnContext {
  adapter?: string;        // "slack" 등
  channelId?: string;      // bare Slack channel id (C.../G.../D...)
  threadId?: string;       // chat-sdk thread id (slack:C...:ts)
  trigger?: 'mention' | 'subscribed-message' | 'schedule';
}

export function getTurnContext(): SenaTurnContext | undefined;
export function runWithTurnContext<T>(context: SenaTurnContext, fn: () => T): T;
```

`run()` 의 두 chat-sdk 콜백(`onNewMention`, `onSubscribedMessage`) 진입 시 `runWithTurnContext({...}, () => handler(...))` 로 감싸 핸들러 → `streamText` → middleware 체인까지 같은 AsyncLocalStorage frame 안에서 실행된다. 따라서 `channelContext` middleware 의 `transformParams` 가 `getTurnContext()` 로 trigger 의 channelId 를 얻어 `channels.json` + `memory.md` 를 system prompt 에 prepend 할 수 있다.

`scheduleFanOut.ts` 의 cron 발화 콜백도 동일 패턴 (`trigger: 'schedule'`) 으로 감싸 cron prompt turn 도 channel context 를 받는다.

helper:

- `channelIdFromChatSdkId('slack:C0AFW...:1234.5678') === 'C0AFW...'`
- `adapterFromChatSdkId('slack:C...') === 'slack'`

## 프로세스 구조 (확정 결정 #3)

**단일 Node 프로세스** 안에 다음 레이어가 같이 있다:

1. **chat-sdk Chat 인스턴스** — 어댑터·state·핸들러 등록.
2. **우리 drain wrapper** — `inFlight` 카운터를 핸들러 진입/탈출 시 증감. SIGTERM 받으면 `draining=true` 플래그 + `inFlight=0` 될 때까지 200ms 폴링 (60s timeout) 후에 `chat.shutdown()` 호출. `process.exit` 은 호출자 책임.
3. **우리 steering 레이어** — `chat-sdk concurrency: "concurrent"` 로 thread lock 우회 + thread 별 `Map<threadKey, { controller: AbortController, partialText, pendingSteer? }>` 관리. 새 메시지 도착 시 기존 controller `.abort()` → ai-sdk `streamText({ abortSignal })` 로 전파 → 같은 핸들러 내부 loop 가 새 컨텍스트로 다음 turn 재시작. step-steering 모드는 `tool-result` chunk 경계에서만 abort.
4. **ai-sdk middleware 체인** — `wrapLanguageModel({ model, middleware: [channelContext, traceLogger] })`. 둘 다 `runtime/turn-context.ts` AsyncLocalStorage frame 안에서 실행되어 trigger-time channel/thread id 에 접근 가능.
5. **provider** — `claudeCode()` 또는 `codexCli()` 가 LanguageModel 호출 받고 CLI subprocess spawn.
6. **schedule fan-out** — `node-cron` 이 KST 로 cron 표현 해석 → 발화 시 같은 `runWithTurnContext` + `streamText` + chat-sdk `thread.post`/`channel.post` 경로로 합류.

### Zero-downtime rolling restart

같은 xapp 토큰으로 두 인스턴스가 동시에 socket connect 가능 (Slack 공식 멀티 소켓 분산 라우팅). 따라서 SIGUSR2 기반 v2 패턴 대신:

1. 새 인스턴스 띄움 → socket connect (Slack 이 새 이벤트를 양쪽에 분산)
2. 기존 인스턴스 SIGTERM → drain wrapper 가 inFlight=0 될 때까지 대기
3. 기존 인스턴스 자연 exit (호출자 시그널 핸들러가 `app.shutdown()` 후 `process.exit(0)`)

→ in-flight turn 은 끝까지 처리되고 새 인스턴스가 새 이벤트를 받는다.

## 데이터 흐름 (한 turn)

1. **트리거 도착** — Slack `app_mention` / `message` / `reaction_added` 또는 cron 발화.
2. **chat-sdk handler 진입** — Slack adapter 가 trigger 를 chat-sdk Conversation/Thread/Message 객체로 변환. cron 트리거는 `setupScheduleFanOut` 콜백에서 `chat.thread()/channel()` reference 로 합류.
3. **drain.track + runWithTurnContext** — `run()` 이 등록한 콜백이 `drain.track(label, ...)` 으로 in-flight 카운터 +1 하고, `runWithTurnContext({ adapter, channelId, threadId, trigger }, () => handler(...))` 로 AsyncLocalStorage frame 진입.
4. **handler 본문** — `gracefulDrainSkip` → 텍스트 정규화(`stripLeadingMention`) → steering slot 등록 → `streamText({ model, tools, stopWhen: tools && stepCountIs(maxSteps), prompt, abortSignal })`.
5. **ai-sdk middleware 적용** — `wrapLanguageModel({ model, middleware: [channelContext, traceLogger] })`. `channelContext.transformParams` 가 `getTurnContext().channelId` 로 `channels.json` + `channels/{id}/memory.md` 를 system message 에 prepend, `traceLogger.wrapStream` 이 chunk 분포 + elapsed 를 한 줄 요약.
6. **provider 호출** — `claudeCode()` 또는 `codexCli()` 가 LanguageModel 인터페이스로 호출 받고 내부적으로 CLI 를 spawn 하여 turn 진행.
7. **chat-sdk 가 출력 처리** — streaming preview, 최종 메시지(unfurl · table · mrkdwn) 는 `@chat-adapter/slack` 이 책임. cron 은 `await result.text` → `thread.post(text)` / `channel.post(text)` 로 string post.

## 그림

> PRD §"시각화 — 아키텍처 레이어" 다이어그램과 동일한 구조 ([HTML view](https://reports.yechanny.workers.dev/sena-v3-prd/#architecture)). 여기서는 텍스트 요약만 둔다.

## 검증 결과 (rev. 3)

- ✅ chat-sdk 는 자체 system prompt 합성 hook 을 노출하지 않음. 우리 미들웨어(channel context) 는 ai-sdk `transformParams` + AsyncLocalStorage 의 trigger-time channelId 조합.
- ✅ `ScheduledMessage` 는 미래 발송 1-shot 이라 cron 트리거 흡수 안 함. 우리가 `setupScheduleFanOut` 으로 직접 짠다 (`docs/specs/schedules.md` 참조).
- ✅ `run()` 통합 entry — `defineConfig` 는 정규화만, 실제 `new Chat({...})` + middleware wrap + drain + steering + signal + cron fan-out 합치는 책임은 모두 `run()`.
- ✅ starter (`templates/slack-agent/`) 는 한 파일에서 동작하는 최소 운영 봇 + .sena 보조 자료.
- ✅ middleware 가 channelId 를 알기 위한 prop drilling 대신 AsyncLocalStorage 채택 (`runtime/turn-context.ts`).

## AC

1. Slack `app_mention` 한 발이 도착했을 때, 1~7 흐름이 우리 얇은 앱 레이어(middleware + drain wrapper + steering + turn-context) 를 거쳐 응답으로 돌아온다.
2. `cronSchedule` 한 발이 발화했을 때 같은 LanguageModel 호출 경로(5~6) 를 거치며, 결과가 지정된 channel/thread 에 일반 메시지처럼 누적된다.
3. starter (`templates/slack-agent/`) 가 환경변수 3개(`SLACK_APP_TOKEN`/`SLACK_BOT_TOKEN`/`DATABASE_URL`) 로 그대로 부팅되고, mention 한 번에 응답이 나간다.
4. 우리가 publish 하는 코드 줄 수가 v2 대비 80% 이상 줄어든다 (감각 기준; PRD `S-2` 측정의 보조 지표).
