# Vault

## 한 줄 요약

플랫폼 민감 정보를 AES-256-GCM으로 암복호화하고 Node.js/CF Workers 간 호환 가능한 암호문 포맷을 유지한다.

## 상위 스펙 연결

- Related Requirements: `PLATFORM-FR-005`, `PLATFORM-NFR-001`
- Related AC: `PLATFORM-AC-005`, `PLATFORM-AC-006`

## Behavior

### `PLATFORM-VAULT-01` 암호화

- Trigger: `encrypt(plaintext)`
- Main Flow:
  - 32바이트 master key와 랜덤 IV로 AES-256-GCM 암호화를 수행한다.
  - `base64(IV + AuthTag + Ciphertext)` 형식으로 인코딩한다.

### `PLATFORM-VAULT-02` 복호화

- Trigger: `decrypt(encoded)`
- Main Flow:
  - 저장 형식을 파싱해 IV, auth tag, ciphertext를 분리한다.
  - 원문 문자열을 복원한다.

### `PLATFORM-VAULT-03` 런타임 간 호환

- Trigger: Node에서 쓴 암호문을 CF에서 읽거나 그 반대
- Main Flow:
  - 두 구현이 동일한 바이너리 레이아웃을 유지한다.

## Constraints

- `PLATFORM-VAULT-C-001`: master key는 64자 hex, 32바이트 길이여야 한다.
- `PLATFORM-VAULT-C-002`: 저장 포맷은 Node/CF 양쪽에서 동일해야 한다.
- `PLATFORM-VAULT-C-003`: 평문 토큰/시크릿은 저장 계층에 직접 내려가면 안 된다.

## Interface

- `Vault`
  - `encrypt(plaintext: string): Promise<string>`
  - `decrypt(encoded: string): Promise<string>`
- Runtimes:
  - `createNodeVault(masterKeyHex)`
  - `createCfVault(masterKeyHex)`

## Realization

- 모듈 경계:
  - `runtime/node/vault.ts`, `runtime/cf/vault.ts`
- 상태 모델:
  - 키는 초기화 시 import/Buffer 변환 후 런타임 객체 안에 유지한다.

## Dependencies

- Depends On: Node crypto, Web Crypto
- Blocks: `auth.md`, `database.md`, `relay.md`, `slack-integration.md`
- Parallelizable With: `runtime.md`

## AC

- Given 유효한 master key가 있을 때 When `encrypt()` 후 `decrypt()`를 호출하면 Then 원문이 복원된다.
- Given Node 또는 CF 환경일 때 When 같은 암호문을 처리하면 Then 동일한 저장 포맷으로 해석된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

