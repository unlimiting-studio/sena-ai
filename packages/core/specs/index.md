# @sena-ai/core

## 한 줄 요약

"sena-ai 사용자가 설정 기반으로 에이전트를 정의하고, 턴 실행, 워커 서빙, 스케줄, 오케스트레이션, 도구 계약을 하나의 코어 패키지에서 일관되게 조립한다."

## 문제 정의

- 현재 상태:
  런타임, 커넥터, 훅, 도구는 서로 다른 실행 모델을 가지지만 공통 턴 실행 계약 위에서 함께 동작해야 한다.
- Pain Point:
  코어 계약이 느슨하면 패키지마다 세션, 도구, 이벤트, 워커 생명주기를 임의 해석하게 된다.
- 우선순위 근거:
  `@sena-ai/core`는 모든 상위 패키지의 기반이므로 사소한 계약 변화도 모노레포 전체 회귀로 이어진다.

## 목표 & 성공 지표

- 설정 해석, 턴 실행, 워커, 오케스트레이터, 스케줄러, 도구, 타입 계약이 분리된 책임 단위 문서로 추적된다.
- `CORE-FR-001`부터 `CORE-FR-009`까지 세부 파일과 1:1로 연결된다.
- 런타임/커넥터/훅/도구 패키지가 core 계약만으로 상호 운용 가능하다.

## 스펙 안정성 분류

- `Stable`
  - 설정 정규화, 턴 실행, 워커/오케스트레이터, 스케줄러, 도구, 타입, env 계약
- `Flexible`
  - 로그/문서 표현 방식, 내부 구현 세부 메모
- `Experimental`
  - 현재 없음

## 스펙 안정성 분류

- `Stable`: `SenaConfig`/`ResolvedSenaConfig`, `RuntimeEvent`/`ToolPort`, Worker/Orchestrator 생명주기, Scheduler 중복 실행 방지, env 검증 계약
- `Flexible`: 기본값 채우기 순서, 로그 표현, 테스트 구성, 내부 helper 명명
- `Experimental`: 현재 없음

## 용어 정의

- `SenaConfig`: 사용자가 선언하는 원본 에이전트 설정.
- `ResolvedSenaConfig`: 기본값과 검증이 끝난 실행용 설정.
- `Turn`: 사용자 입력에서 런타임 결과까지의 한 번의 처리 단위.
- `TurnTrace`: 턴 실행의 컨텍스트, 훅, 결과, 에러, follow-up을 담는 추적 객체.
- `Worker`: 커넥터/스케줄/세션/서버를 포함한 실행 프로세스.
- `Orchestrator`: 워커 자식 프로세스와 프록시를 관리하는 상위 프로세스.

## 요구사항

- `CORE-FR-001` [Committed][Stable]: `defineConfig`는 `SenaConfig`를 `ResolvedSenaConfig`로 정규화하고 중복 도구 이름을 검증해야 한다.
- `CORE-FR-002` [Committed][Stable]: Turn Engine은 훅, 컨텍스트 조립, 런타임 스트림, 에러/후속 턴을 포함한 표준 턴 실행 파이프라인을 제공해야 한다.
- `CORE-FR-003` [Committed][Stable]: Agent 래퍼는 프로그래밍 방식의 단일 턴 실행 API를 간결하게 노출해야 한다.
- `CORE-FR-004` [Committed][Stable]: Worker는 커넥터 서빙, 세션 저장, steer 큐잉, graceful drain, 내장 도구 등록을 담당해야 한다.
- `CORE-FR-005` [Committed][Stable]: Orchestrator는 Worker 자식 프로세스와 HTTP 프록시를 관리하고 zero-downtime rolling restart를 지원해야 한다.
- `CORE-FR-006` [Committed][Stable]: Scheduler는 heartbeat와 cron 스케줄을 실행하고 동일 스케줄의 동시 실행을 막아야 한다.
- `CORE-FR-007` [Committed][Stable]: Tool 헬퍼는 인라인 도구와 멀티모달 결과를 공통 포트 계약으로 정의해야 한다.
- `CORE-FR-008` [Committed][Stable]: 공유 타입은 런타임, 커넥터, 훅, 도구가 같은 표면 계약을 사용하도록 고정해야 한다.
- `CORE-FR-009` [Committed][Stable]: 환경 변수 유틸리티는 누락 변수를 지연 수집하고 시작 직전 일괄 검증해야 한다.
- `CORE-NFR-001` [Committed][Stable]: 코어 계약은 하위 패키지에서 구현 가능한 수준으로 충분히 구체적이되 런타임 세부에는 종속되지 않아야 한다.
- `CORE-NFR-002` [Committed][Stable]: 에러와 종료 경로는 graceful shutdown, hook isolation, pending queue 보존을 깨지 않아야 한다.
- `CORE-NFR-003` [Committed][Stable]: 오케스트레이터와 워커는 무중단 교체와 crash recovery를 지원해야 한다.

## 수용 기준 (AC)

- `CORE-AC-001`: Given 최소 설정만 제공될 때, When `defineConfig()`를 호출하면, Then 실행에 필요한 기본값이 모두 채워진 `ResolvedSenaConfig`가 반환된다. 관련: `CORE-FR-001`
- `CORE-AC-002`: Given 턴 실행 중 런타임이 progress/tool/result 이벤트를 보낼 때, When Turn Engine이 이를 소비하면, Then `TurnTrace`와 hook 실행 결과가 일관되게 누적된다. 관련: `CORE-FR-002`, `CORE-FR-008`
- `CORE-AC-003`: Given 같은 대화에 메시지가 연속 도착할 때, When Worker가 이를 처리하면, Then 활성 턴은 steer를 시도하고 남은 메시지는 후속 턴으로 보존된다. 관련: `CORE-FR-004`
- `CORE-AC-004`: Given rolling restart 요청이 들어올 때, When Orchestrator가 새 Worker를 띄우면, Then 새 Worker ready 이후에만 트래픽이 전환되고 이전 Worker는 drain된다. 관련: `CORE-FR-005`, `CORE-NFR-003`
- `CORE-AC-005`: Given 누락된 필수 환경 변수가 여러 개 있을 때, When `validateEnv()`를 호출하면, Then 누락 목록이 한 번에 보고된다. 관련: `CORE-FR-009`

## 의존관계 맵

- Depends On: Node.js 프로세스/시그널 모델, 파일 시스템 기반 설정 import, 하위 패키지의 core 타입 준수
- Blocks: `@sena-ai/cli`, `@sena-ai/hooks`, `@sena-ai/tools`, `@sena-ai/runtime-*`, connector 계층 전반
- Parallelizable With: 하위 패키지의 구현/문서 정리 작업 중 core 외부 계약을 바꾸지 않는 변경

## 범위 경계 (Non-goals)

- 특정 LLM 제공자 SDK의 세부 프로토콜 정의.
- 특정 커넥터의 HTTP/WebSocket 이벤트 스키마 정의.
- 영속 스토리지나 배포 플랫폼 구현 세부.

## 제약 & 가정

- 코어는 Node.js 환경을 기본 실행 기반으로 사용한다.
- 런타임, 커넥터, 훅, 도구 구현은 core 타입 계약을 준수한다고 가정한다.
- 스케줄러와 워커는 장시간 실행 프로세스 모델을 전제로 한다.

## 리스크 & 완화책

- 계약 파편화 리스크:
  런타임/커넥터가 각자 필드를 확장하면 상호 운용성이 깨진다.
  완화: `types.md`를 Stable 계약으로 둔다.
- graceful shutdown 리스크:
  워커와 오케스트레이터 종료 순서가 어긋나면 턴 유실이 생긴다.
  완화: Worker/Orchestrator 상세 스펙에서 종료 순서를 명시한다.
- 설정 회귀 리스크:
  기본값 또는 env 검증 변경이 초기화 실패로 이어질 수 있다.
  완화: `defineConfig`, `env`를 별도 책임으로 분리한다.

## 검증 계획

- `packages/core/src/__tests__/*.test.ts`를 기준 검증 세트로 유지한다.
- config/env/engine/worker/orchestrator/scheduler/tool 각각의 단위 테스트와 통합 테스트를 유지한다.
- 스펙 검증은 각 상세 스펙의 AC가 해당 테스트 파일과 연결되는지 확인하는 방식으로 수행한다.

## 상세 스펙 맵

- [defineConfig.md](/Users/channy/workspace/sena-ai/packages/core/specs/defineConfig.md)
- [env.md](/Users/channy/workspace/sena-ai/packages/core/specs/env.md)
- [turn-engine.md](/Users/channy/workspace/sena-ai/packages/core/specs/turn-engine.md)
- [agent.md](/Users/channy/workspace/sena-ai/packages/core/specs/agent.md)
- [worker.md](/Users/channy/workspace/sena-ai/packages/core/specs/worker.md)
- [orchestrator.md](/Users/channy/workspace/sena-ai/packages/core/specs/orchestrator.md)
- [scheduler.md](/Users/channy/workspace/sena-ai/packages/core/specs/scheduler.md)
- [tool.md](/Users/channy/workspace/sena-ai/packages/core/specs/tool.md)
- [types.md](/Users/channy/workspace/sena-ai/packages/core/specs/types.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
