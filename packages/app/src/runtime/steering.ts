/**
 * Steering 레이어 — chat-sdk에는 native가 없는 "진행 중 turn abort + 새 컨텍스트 재시작"을
 * AbortController 기반으로 직접 구현한다.
 *
 * SPEC `architecture.md` (rev. 2) §"프로세스 구조" 그대로:
 * - chat-sdk concurrency를 `concurrent`로 두어 thread lock 우회
 * - thread별 `Map<threadKey, SteeringSlot>` 보관
 * - 새 메시지 도착 시 기존 controller.abort() → ai-sdk `streamText({ abortSignal })`로
 *   전파되어 stream 정상 종료(error=1로 마감) → 같은 핸들러 내부 loop가 새 컨텍스트로 재시작
 *
 * step-단위 옵션(`mode: "step"`)은 `tool-result` chunk를 step 경계 신호로 써서
 * mid-tool-call 인터럽트를 회피한다 (기본 `immediate`).
 *
 * PoC 라이브 검증 결과:
 * - immediate: 진행 중 turn elapsedMs=20415, partialChars=0에서 abort → 새 turn 11242ms
 * - step: tool-call=2 tool-result=2 짝수 마감 후 abort → 새 turn 5917ms
 */

export interface SteeringSlot {
  /** 진행 중 turn의 AbortController */
  controller: AbortController;
  /** turn 시작 시각 (ms) */
  startedAt: number;
  /** 이 turn이 처리 중인 사용자 요청 텍스트 */
  currentRequest: string;
  /** 진행 중 turn이 누적한 응답 텍스트 (text-delta 합) */
  partialText: string;
  /**
   * step-mode에서: 새 메시지가 들어왔지만 즉시 abort 하지 않고 다음 step 경계
   * (tool-result chunk)에서 abort 시키기 위해 보관.
   */
  pendingSteer?: { text: string; receivedAt: number };
}

export class SteeringRegistry {
  private slots = new Map<string, SteeringSlot>();

  get(threadKey: string): SteeringSlot | undefined {
    return this.slots.get(threadKey);
  }

  set(threadKey: string, slot: SteeringSlot): void {
    this.slots.set(threadKey, slot);
  }

  /**
   * Atomic check-and-register (codex P1 round 10).
   * - 기존 slot 이 있으면 그대로 반환하고 set 하지 않음 → 호출자는 기존 turn 의 pendingSteer
   *   적재 등 in-flight 경로로 분기.
   * - 없으면 새 slot 을 등록하고 undefined 반환 → 호출자는 새 turn 시작.
   *
   * Map 의 get + set 은 동기 연산이므로 microtask boundary 가 끼지 않아 같은 thread 에 메시지가
   * 거의 동시에 도착해도 "한 thread 당 하나의 새 turn" 이 보장된다 (step-steering 의 핵심).
   */
  setIfAbsent(threadKey: string, slot: SteeringSlot): SteeringSlot | undefined {
    const existing = this.slots.get(threadKey);
    if (existing) return existing;
    this.slots.set(threadKey, slot);
    return undefined;
  }

  /** 우리가 등록한 slot이 그대로 남아있을 때만 정리 (race-safe) */
  releaseIf(threadKey: string, slot: SteeringSlot): void {
    if (this.slots.get(threadKey) === slot) {
      this.slots.delete(threadKey);
    }
  }

  /** 강제 정리 (예: shutdown 시) */
  clear(): void {
    for (const slot of this.slots.values()) {
      slot.controller.abort();
    }
    this.slots.clear();
  }
}
