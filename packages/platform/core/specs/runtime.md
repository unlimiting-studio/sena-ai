# Runtime Implementations

## 한 줄 요약

플랫폼 코어는 Node.js와 Cloudflare Workers에서 동일한 `Platform` 계약을 조립할 수 있도록 런타임별 Vault, Relay, Crypto 구현을 제공한다.

## 상위 스펙 연결

- Related Requirements: `PLATFORM-FR-006`, `PLATFORM-FR-007`
- Related AC: `PLATFORM-AC-006`

## Behavior

### `PLATFORM-RUNTIME-01` Node.js 런타임 조립

- Trigger: `createNodeRuntime(config)`
- Main Flow:
  - Node Vault, SSE Relay, Node Crypto를 조립해 반환한다.

### `PLATFORM-RUNTIME-02` Cloudflare Workers 런타임 조립

- Trigger: `createCfRuntime(env)`
- Main Flow:
  - CF Vault, DO Relay, CF Crypto를 비동기로 초기화해 반환한다.

### `PLATFORM-RUNTIME-03` 공통 Crypto 계약

- `randomHex`, `uuid`, `hmacSha256`, `timingSafeEqual`를 Promise 기반 공통 인터페이스로 제공한다.

## Constraints

- `PLATFORM-RUNTIME-C-001`: 런타임별 구현 차이가 있어도 `Vault`, `RelayHub`, `CryptoProvider` 외부 계약은 동일해야 한다.
- `PLATFORM-RUNTIME-C-002`: CF와 Node의 Vault 포맷은 상호 호환 가능해야 한다.
- `PLATFORM-RUNTIME-C-003`: timing-safe 비교는 각 런타임의 보안 특성에 맞게 구현해야 한다.

## Interface

- Node:
  - `createNodeRuntime(config: NodeRuntimeConfig): NodeRuntime`
- CF:
  - `createCfRuntime(env: CfEnv): Promise<CfRuntime>`
- Shared:
  - `CryptoProvider`
  - `Vault`
  - `RelayHub`

## Realization

- 모듈 경계:
  - `runtime/node/*`, `runtime/cf/*`가 각 책임을 나눈다.
- 상태 모델:
  - Node는 동기 초기화, CF는 Web Crypto import와 Durable Object binding 때문에 비동기 초기화가 필요하다.

## Dependencies

- Depends On: `vault.md`, `relay.md`
- Blocks: `platform-node`, `platform-worker`
- Parallelizable With: `database.md`

## AC

- Given Node.js 환경일 때 When `createNodeRuntime()`을 호출하면 Then Node용 Vault/Relay/Crypto 조합을 얻는다.
- Given CF Workers 환경일 때 When `createCfRuntime()`을 호출하면 Then CF용 Vault/Relay/Crypto 조합을 얻는다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

