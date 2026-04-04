# defineConfig

## 한 줄 요약

`defineConfig()`는 선언형 `SenaConfig`를 실행 가능한 `ResolvedSenaConfig`로 정규화하고 설정 충돌을 조기에 차단한다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-001`
- 관련 수용 기준: `CORE-AC-001`

## Behavior

- Trigger:
  사용자가 설정 파일에서 `defineConfig()`를 호출한다.
- Main Flow:
  1. 필수 필드 `name`, `runtime`을 포함한 `SenaConfig`를 받는다.
  2. `cwd`, `connectors`, `tools`, `hooks`, `schedules` 기본값을 채운다.
  3. `tools[].name`의 유일성을 검증한다.
  4. `orchestrator`는 제공된 경우에만 결과에 포함한다.
- Failure Modes:
  중복 도구 이름이 있으면 즉시 예외를 던진다.

## Constraints

- `CORE-CONFIG-CON-001`: 기본값은 실행 시점의 `process.cwd()`와 빈 컬렉션 규칙을 따라야 한다.
- `CORE-CONFIG-CON-002`: 도구 이름 중복은 경고가 아니라 예외여야 한다.
- `CORE-CONFIG-CON-003`: 선택적 `orchestrator`는 사용자가 제공하지 않으면 결과에 강제 주입하지 않는다.

## Interface

- API:
  `defineConfig(config: SenaConfig): ResolvedSenaConfig`
- 입력:
  `name`, `runtime`, 선택적 `cwd`, `connectors`, `tools`, `hooks`, `schedules`, `orchestrator`
- 출력:
  기본값과 검증이 적용된 `ResolvedSenaConfig`

## Realization

- 설정 정규화는 얕은 구조 병합으로 수행한다.
- 유일성 검증은 `tools` 배열에만 적용한다.

## Dependencies

- Depends On:
  [types.md](/Users/channy/workspace/sena-ai/packages/core/specs/types.md)
- Blocks:
  Agent/Worker/CLI 초기화 경로
- Parallelizable With:
  [env.md](/Users/channy/workspace/sena-ai/packages/core/specs/env.md)

## AC

- Given 필수 필드만 있는 설정, When `defineConfig()`를 호출하면, Then 나머지 선택 필드는 기본값으로 채워진다.
- Given 같은 이름의 도구 두 개, When `defineConfig()`를 호출하면, Then 중복 도구 이름 예외가 발생한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

