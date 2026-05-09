/**
 * 앱 entry — INTERNAL 스캐폴딩 (§1 step 2 단계).
 *
 * step 3에서 chat-sdk Chat 인스턴스 통합 + handler/schedule fan-out을 채운 뒤에야
 * 외부 export로 끌어올린다. step 2의 외부 surface는 wrapper 도구
 * (`createDrainController`, `SteeringRegistry`, `safePostStream`,
 * `traceLogger`, `cronSchedule`)뿐이다.
 *
 * 이 파일을 외부에 노출하지 않는 이유:
 * - 미구현 함수가 타입상 정상 시그니처(`Promise<RunningApp>`)를 약속하면 소비자가
 *   `await run(...)`으로 통합한 뒤 런타임에서 throw로 깨진다 (codex P2).
 * - fail-fast 정책: 외부 계약은 작동하는 코드만 노출.
 */
