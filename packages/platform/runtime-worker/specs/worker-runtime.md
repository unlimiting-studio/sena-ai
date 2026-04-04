# Worker Runtime Entry

## 한 줄 요약

Cloudflare Worker entry는 fetch와 scheduled 트리거에서 platform-core를 조립하고 bootstrap/rotation 책임을 수행한다.

## 상위 스펙 연결

- 관련 요구사항: `PLATFORM-WORKER-FR-001`, `PLATFORM-WORKER-FR-002`, `PLATFORM-WORKER-FR-003`, `PLATFORM-WORKER-NFR-001`
- 관련 수용 기준: `PLATFORM-WORKER-AC-001`, `PLATFORM-WORKER-AC-002`, `PLATFORM-WORKER-AC-003`

## Behavior

- Trigger:
  fetch 요청 또는 scheduled 이벤트가 들어온다.
- Main Flow:
  1. `createCfRuntime(env)`로 runtime을 초기화한다.
  2. `initD1(env.DB)`와 `createD1Repositories()`로 repositories를 만든다.
  3. fetch 경로에서는 bootstrap token 존재 여부를 확인하고 필요 시 암호화 저장한다.
  4. `createApp()` 또는 `createProvisioner()`를 만들어 각각 fetch/scheduled 책임을 수행한다.
- Failure Modes:
  runtime, DB, vault 초기화 실패는 해당 이벤트 실패로 이어진다.

## Constraints

- `PLATWORKER-CON-001`: bootstrap token은 기존 row가 없을 때만 저장해야 한다.
- `PLATWORKER-CON-002`: scheduled rotation 실패는 개별 workspace 단위로 격리해야 한다.
- `PLATWORKER-CON-003`: fetch와 scheduled는 같은 runtime/repository 계약을 사용해야 한다.

## Interface

- Env:
  `DB`, `SLACK_CONFIG_TOKEN?`, `SLACK_CONFIG_REFRESH_TOKEN?`, `PLATFORM_BASE_URL`, `SLACK_WORKSPACE_ID`, `VAULT_MASTER_KEY`, `RELAY_DO`
- Worker 표면:
  `fetch(request, env, ctx)`, `scheduled(event, env)`

## Realization

- fetch handler는 bootstrap + app.fetch 조합에 집중한다.
- scheduled handler는 provisioner를 직접 만들어 rotation만 수행한다.

## Dependencies

- Depends On:
  [platform-core](/Users/channy/workspace/sena-ai/packages/platform/core/specs/index.md), [relay-durable-object.md](/Users/channy/workspace/sena-ai/packages/platform/runtime-worker/specs/relay-durable-object.md)
- Blocks:
  Workers 배포 경로
- Parallelizable With:
  D1 마이그레이션 운영

## AC

- Given DB에 token이 없고 env에 bootstrap token이 있을 때, When 첫 fetch가 실행되면, Then 암호화된 token row가 upsert된다.
- Given scheduled trigger, When handler가 실행되면, Then 모든 config token에 대해 rotation이 시도된다.
- Given fetch 요청, When app이 조립되면, Then `app.fetch()` 응답이 그대로 반환된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 섹션 구조와 추적 가능성을 보강했다.
