# env

## 한 줄 요약

`env()`와 `validateEnv()`는 설정 파일 평가 단계에서 누락 환경 변수를 수집하고 시작 직전 일괄 검증한다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-009`
- 관련 수용 기준: `CORE-AC-005`

## Behavior

- Trigger:
  설정 파일이 `env(key, defaultValue?)`를 호출하고, 이후 시작 전에 `validateEnv()`를 호출한다.
- Main Flow:
  1. 환경 변수가 있으면 값을 반환한다.
  2. 없지만 기본값이 있으면 기본값을 반환한다.
  3. 둘 다 없으면 빈 문자열을 반환하고 누락 목록에 기록한다.
  4. `validateEnv()`는 누락 목록이 있으면 `EnvValidationError`를 던진다.
- Failure Modes:
  누락 값이 하나라도 있으면 시작 전에 예외가 난다.

## Constraints

- `CORE-ENV-CON-001`: 누락 변수는 첫 호출 시 누적되어야 한다.
- `CORE-ENV-CON-002`: 에러 이름은 `EnvValidationError`여야 한다.
- `CORE-ENV-CON-003`: `validateEnv()`는 누락이 없으면 부수효과 없이 종료해야 한다.

## Interface

- API:
  `env(key: string, defaultValue?: string): string`
  `validateEnv(): void`

## Realization

- 모듈 수준 누락 집합을 유지해 설정 평가 전체에서 누적한다.

## Dependencies

- Depends On:
  없음
- Blocks:
  config loader와 runtime 초기화 경로
- Parallelizable With:
  [defineConfig.md](/Users/channy/workspace/sena-ai/packages/core/specs/defineConfig.md)

## AC

- Given 값이 있는 환경 변수, When `env(key)`를 호출하면, Then 실제 값을 반환한다.
- Given 기본값만 있는 호출, When `env(key, default)`를 호출하면, Then 기본값을 반환한다.
- Given 누락 변수가 여러 개, When `validateEnv()`를 호출하면, Then 모든 키가 포함된 `EnvValidationError`가 발생한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

