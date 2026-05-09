/**
 * Schedule fan-out — `cronSchedule({ name, cron, target, prompt })` 배열을 받아 `node-cron`
 * 으로 등록하고, 발화 시점에 `chat.thread()/channel()` reference + `streamText` + string post
 * 패턴으로 cron turn 을 흘린다 (PoC 0단계 검증 패턴 그대로).
 *
 * SPEC: `docs/specs/schedules.md` rev. 2.
 *
 * 차니 우려 (state 호환성) 와 step 4.5 롤백 이력:
 *  - 차니 우려: "state 가 chat-sdk 에 저장되는데 cron 이 chat-sdk 우회하면 다른 채팅 간 호환성 깨지지 않을지".
 *  - **outbound** (cron 응답이 chat-sdk thread/channel state 에 어떻게 기록되는가): 이미 깨끗.
 *    cron 발화 끝에 `thread.post(text) / channel.post(text)` 를 chat-sdk 통해 호출하므로 일반
 *    mention turn 의 응답과 똑같이 state-pg 에 기록된다. 호환성 안 깨짐.
 *  - **inbound** (cron 발화가 prior history 를 읽고 답해야 하는가): cron 은 *stand-alone trigger* 라
 *    history 의존 없는 게 본질에 맞다. step 4.5 로 history-aware 모드를 잠깐 시도했지만 두 회귀
 *    (codex round 2): ① 채널 dispatch 시 채널 임의 잡담이 모델 input 에 섞임 ② thread dispatch 시
 *    cron prompt 가 thread 에 안 남아 다음 발화 history 가 assistant-only 비대칭 → 롤백.
 *  - history-aware 가 정말 필요한 시나리오 (예: thread 안에서 누적되는 정기 리포트) 는 step 5+ 에서
 *    SPEC §"동작 (1차 가설)" 1번 (state adapter history load) 을 제대로 닫고 별도 다룬다.
 *
 * 1차 (step 4) 동작:
 *  - cron 표현은 KST(`Asia/Seoul`) 시간대로 해석.
 *  - `prompt: { file }` 은 발화 시점 lazy read (재시작 없이 prompt 파일만 수정해 다음 발화에 반영).
 *  - 출력은 `await result.text` → `thread.post(text)` 또는 `channel.post(text)` (PoC 발견 #1:
 *    `Thread.handleStream` 외부 reference 깨짐 우회).
 *  - 발화 turn 도 `drain.track` 으로 감싸 SIGTERM 시 in-flight cron 도 같이 drain.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import { streamText } from "ai";
import type { Chat } from "chat";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import nodeCron, { type ScheduledTask } from "node-cron";
import type { Schedule, ScheduleTarget } from "../schedules/cron.js";
import type { DrainController } from "./drain.js";

export interface ScheduleFanOutDeps {
  chat: Chat;
  model: LanguageModelV3;
  drain: DrainController;
  /** SenaConfig.cwd — `{ file }` prompt 의 baseDir */
  cwd: string;
  log: (msg: string) => void;
}

export interface ScheduleFanOut {
  /** 등록된 모든 cron task 정지/정리 (shutdown 시 호출) */
  stop(): Promise<void>;
}

const TIMEZONE = "Asia/Seoul";

export async function setupScheduleFanOut(
  schedules: Schedule[],
  deps: ScheduleFanOutDeps,
): Promise<ScheduleFanOut> {
  // codex P1 round 2 — 부분 등록 후 throw 시 cron task leak 방지.
  // Phase 1: 모든 spec 을 *먼저* 검증한다 (cron 표현 + target 형태). 하나라도 실패하면 즉시 throw —
  //          이 시점엔 nodeCron.schedule() 호출이 없었으므로 task 가 등록된 게 없다.
  // Phase 2: 모두 통과 후 한 번에 등록. 등록 도중 시스템 에러로 throw 가 발생하면 already-registered
  //          task 들을 stop+destroy 로 rollback 하고 다시 throw.
  for (const schedule of schedules) {
    const spec = schedule.spec;
    if (!nodeCron.validate(spec.cron)) {
      throw new Error(
        `[@sena-ai/app] invalid cron expression for schedule "${spec.name}": "${spec.cron}"`,
      );
    }
    resolveTarget(spec.target, spec.name); // throws on invalid shape
  }

  const tasks: ScheduledTask[] = [];

  // codex P2 round 5 — drain.draining 만 보면 race 가 남는다 (run.ts 의 shutdown 순서가
  // fanOut.stop() → drain.shutdown 이라 fanOut.stop() 시점엔 drain.draining 가 아직 false).
  // ScheduleFanOut 자체 stopping flag 를 두고 콜백 진입 시 *먼저* 검사한다 — fanOut.stop()
  // 첫 줄에 stopping=true 를 박아 이후 tick 콜백은 drain 상태와 무관하게 즉시 빠진다.
  let stopping = false;

  try {
    for (const schedule of schedules) {
      const spec = schedule.spec;
      const task = nodeCron.schedule(
        spec.cron,
        async () => {
          // codex P2 round 3+5 — scheduleFanOut.stop() 직전에 이미 event loop 에 올라간 tick 이
          // 그대로 진입할 수 있다. stopping 이 먼저 (run.ts shutdown 순서 의존성 제거),
          // drain.draining 도 fallback 으로 같이 본다.
          if (stopping || deps.drain.draining) {
            deps.log(
              `[sena] schedule.skip name=${spec.name} reason=${stopping ? "stopping" : "draining"}`,
            );
            return;
          }
          await deps.drain.track(`schedule:${spec.name}`, async () => {
            try {
              const promptText = await resolvePromptText(spec.prompt, deps.cwd);
              const target = resolveTarget(spec.target, spec.name);
              const result = streamText({ model: deps.model, prompt: promptText });
              // PoC 발견 #1 — `thread.post(stream)` 은 `_currentMessage` 부재로 깨짐. 외부
              // 트리거(cron)는 incoming message 가 없으므로 await text 후 string post.
              const text = await result.text;
              // codex P1 round 1 — slack-channel + threadTs 없으면 channel 신규 메시지로
              // dispatch (아침 브리핑 등 SPEC AC 1 시나리오 지원).
              if (target.kind === "thread") {
                const thread = deps.chat.thread(target.threadId);
                await thread.post(text);
              } else {
                const channel = deps.chat.channel(target.channelId);
                await channel.post(text);
              }
              deps.log(
                `[sena] schedule.fired name=${spec.name} target=${target.kind === "thread" ? target.threadId : target.channelId} chars=${text.length}`,
              );
            } catch (err) {
              // cron 발화 실패는 다음 발화까지 영향 주지 않게 swallow + 로그. 동일 turn 안의
              // 모델 에러 / Slack post 실패가 다음 cron tick 까지 막지 않도록.
              deps.log(`[sena] schedule.error name=${spec.name} err=${String(err)}`);
            }
          });
        },
        // codex P2 round 1 — node-cron 의 noOverlap=true 로 같은 task 의 중첩 실행 차단.
        // 한 turn 이 cron 주기보다 길어져도 다음 tick 은 skip 되어 동일 채널에 중복 발화 안 됨.
        { timezone: TIMEZONE, name: spec.name, noOverlap: true },
      );

      tasks.push(task);
      deps.log(`[sena] schedule.registered name=${spec.name} cron="${spec.cron}" tz=${TIMEZONE}`);
    }
  } catch (err) {
    // codex P1 round 2 — 등록 도중 throw 발생 시 이미 만들어진 task 들을 rollback.
    // 그러지 않으면 부팅이 실패했는데 cron 만 살아남아 유령 발화가 된다.
    deps.log(`[sena] schedules.register.error err=${String(err)} → rolling back ${tasks.length} task(s)`);
    for (const t of tasks) {
      try {
        await t.stop();
        await t.destroy();
      } catch {
        // rollback 중의 stop/destroy 실패는 swallow (이미 throw 가 있음).
      }
    }
    throw err;
  }

  return {
    async stop() {
      // codex P2 round 5 — 새 콜백 진입을 가장 먼저 차단. 이미 loop 에 올라간 tick 도 첫 줄에서 빠진다.
      stopping = true;
      for (const t of tasks) {
        try {
          await t.stop();
        } catch (err) {
          deps.log(`[sena] schedule.stop.error name=${t.name ?? t.id} err=${String(err)}`);
        }
      }
      for (const t of tasks) {
        try {
          await t.destroy();
        } catch {
          // destroy 실패는 swallow (process exit 시점이라 영향 없음).
        }
      }
    },
  };
}

async function resolvePromptText(
  prompt: string | { file: string },
  cwd: string,
): Promise<string> {
  if (typeof prompt === "string") return prompt;
  const resolved = path.isAbsolute(prompt.file) ? prompt.file : path.join(cwd, prompt.file);
  return await fs.readFile(resolved, "utf-8");
}

/** Resolved target — chat.thread(threadId) 또는 chat.channel(channelId) 분기 정보. */
type ResolvedTarget =
  | { kind: "thread"; threadId: string }
  | { kind: "channel"; channelId: string };

/**
 * SPEC ScheduleTarget → chat-sdk thread/channel reference. chat-sdk 는 prefixed ID 를 받는다
 * (예: `"slack:C123ABC:1234567890.123456"` thread, `"slack:C123ABC"` channel).
 *
 * 1차 (step 4) 지원:
 *  - `slack-channel` + `threadTs` → `chat.thread("slack:{id}:{threadTs}")` 합성
 *  - `slack-channel` 만 → `chat.channel("slack:{id}")` 신규 메시지 dispatch (codex P1 round 1)
 *
 * step 5+ 로 미룬 것:
 *  - `conversation` type — codex P1 round 4: `target.id` 를 "chat-sdk Conversation id" 로 정의했지만
 *    chat-sdk 가 받는 ID 가 transport-scoped thread key (`slack:...`) 와 같은 형태인지 SPEC 에서
 *    명확치 않다. 미지수가 닫히기 전에 1차 통과시키면 운영 시점에 silent miss 가능. fail-fast.
 *
 * id 가 이미 `:` 를 포함하면 prefix 가 박힌 것으로 보고 그대로 재사용 (다중 어댑터 호환).
 */
function resolveTarget(target: ScheduleTarget, scheduleName: string): ResolvedTarget {
  // codex P2 round 6 — JS 설정 / 이전 빌드 산출물에서 예전 `{ type: "conversation", id }`
  // 객체가 들어오면 타입체크는 우회되지만 우리는 silent 매핑하면 잘못된 Slack 대상으로
  // 발송된다. 런타임 discriminator 검증 + fail-fast 로 차단.
  if (target.type !== "slack-channel") {
    throw new Error(
      `[@sena-ai/app] schedule "${scheduleName}" 의 target.type="${(target as { type?: unknown }).type}" 은 지원하지 않아요. ` +
        '1차 (step 4) 는 target.type="slack-channel" 만. ' +
        "이전 빌드의 conversation 설정이라면 slack-channel + threadTs 로 마이그레이션해주세요.",
    );
  }
  const prefixed = target.id.includes(":") ? target.id : `slack:${target.id}`;
  if (target.threadTs) {
    return { kind: "thread", threadId: `${prefixed}:${target.threadTs}` };
  }
  return { kind: "channel", channelId: prefixed };
}
