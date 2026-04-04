# Config Loader

## 한 줄 요약

CLI가 현재 작업 디렉터리의 `sena.config.ts`와 `.env`를 탐색해 코어 설정으로 넘길 준비를 한다.

## 상위 스펙 연결

- Related Requirements: `CLI-FR-002`
- Related AC: `CLI-AC-002`

## Behavior

### `CLI-CONFIG-01` 설정 파일 탐색

- Trigger: `loadConfig(configPath?)`
- Main Flow:
  - 명시 경로가 있으면 그 파일을 우선 사용한다.
  - 없으면 현재 작업 디렉터리의 `sena.config.ts`를 찾는다.

### `CLI-CONFIG-02` TypeScript 설정 로딩

- Main Flow:
  - TypeScript 설정 파일을 import 가능한 형태로 로드한다.
  - default export와 module export 양쪽을 수용한다.

### `CLI-CONFIG-03` 환경 변수 병합

- Main Flow:
  - 동일 디렉터리의 `.env`를 로드한다.
  - config에 포트가 없으면 `SENA_PORT`를 fallback으로 사용한다.

## Constraints

- `CLI-CONFIG-C-001`: 현재 작업 디렉터리 기준 탐색 규칙은 일관돼야 한다.
- `CLI-CONFIG-C-002`: TypeScript 설정 로딩 실패는 조용히 무시하지 않는다.
- `CLI-CONFIG-C-003`: `.env`는 config를 덮어쓰는 것이 아니라 필요한 fallback만 제공한다.

## Interface

- `loadConfig(configPath?: string): Promise<LoadConfigResult>`
- `LoadConfigResult`
  - 정규화된 config
  - 사용한 config 파일 경로
  - 적용된 포트 및 메타데이터

## Realization

- 모듈 경계:
  - `config-loader.ts`는 파일 탐색, import, `.env` 로딩만 담당한다.
- 실패 처리:
  - 파일이 없거나 import 실패 시 명시적인 예외를 던진다.

## Dependencies

- Depends On: `@sena-ai/core` config 계약, Node.js import/FS
- Blocks: 모든 CLI 명령
- Parallelizable With: `pid.md`

## AC

- Given 현재 디렉터리에 `sena.config.ts`와 `.env`가 있을 때 When `loadConfig()`를 호출하면 Then 둘 다 반영된 설정 결과가 반환된다.
- Given config 포트가 없고 `SENA_PORT`가 있을 때 When `loadConfig()`를 호출하면 Then 포트 fallback이 적용된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

