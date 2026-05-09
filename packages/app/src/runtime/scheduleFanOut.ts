/**
 * Schedule fan-out — `cronSchedule({ name, cron, target, prompt })` 배열을 받아 `node-cron`
 * 으로 등록하고, 발화 시점에 `chat.thread(threadId)` reference + `streamText` + string post
 * 패턴으로 일반 turn flow 를 태운다 (PoC 0단계 검증 패턴 그대로).
 *
 * SPEC: `docs/specs/schedules.md` rev. 2.
 *
 * 1차 동작:
 *  - cron 표현은 KST(`Asia/Seoul`) 시간대로 해석.
 *  - `prompt: { file }` 은 발화 시점 lazy read (재시작 없이 prompt 파일만 수정해 다음 발화에 반영).
 *  - 출력은 `await result.text` → `thread.post(text)` (PoC 발견 #1: `Thread.handleStream`
 *    외부 reference 깨짐 우회).
 *  - 발화 turn 도 `drain.track` 으로 감싸 SIGTERM 시 in-flight cron 도 같이 drain.
 *
 * 미구현 (step 4+):
 *  - `slack-channel` + `threadTs` 미지정 (채널 신규 메시지 dispatch).
 *  - adapter prefix 추론 — 1차에는 'slack:' 고정.
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

  // codex P1 round 2 — SPEC schedules.md §"동작 (1차 가설)" 1번은 "target 이 가리키는
  // chat-sdk Conversation 을 찾는다 (state adapter 에서 history load)" 라고 약속한다.
  // step 4 1차 구현은 prompt-only (history 없이 streamText 직행) 로 단순화했다 — SPEC AC 1~3
  // (morning briefing 채널 dispatch, trace 동등성, file lazy read) 가 모두 history-less
  // 시나리오라 1차 충족에 충분. history-aware turn 은 step 5+ 에서 conversation 핸들러
  // 경로 합류로 별도 다룬다 (chat-sdk Thread.handleStream 외부 reference 깨짐 wrapper 와 함께).
  if (schedules.length > 0) {
    deps.log(
      `[sena] schedules: 1차 구현은 prompt-only (conversation history 없이 streamText 직행). ` +
        `history-aware turn 은 step 5+ 예정.`,
    );
  }

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
