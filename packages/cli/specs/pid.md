# PID Management

## 한 줄 요약

daemon 프로세스를 현재 디렉터리 범위에서 추적하기 위한 PID 파일과 포트 상태 유틸리티를 제공한다.

## 상위 스펙 연결

- Related Requirements: `CLI-FR-003`, `CLI-FR-004`
- Related AC: `CLI-AC-003`, `CLI-AC-004`

## Behavior

### `CLI-PID-01` PID 파일 쓰기/읽기/삭제

- Trigger: daemon 시작 또는 종료
- Main Flow:
  - `writePid(pid)`가 `.sena.pid`를 쓴다.
  - `readPid()`가 파일 내용을 숫자로 읽는다.
  - `removePid()`가 파일을 제거한다.

### `CLI-PID-02` 프로세스 생존 확인

- Trigger: stop/status/restart 전에 실제 프로세스 상태를 확인할 때
- Main Flow:
  - `isProcessAlive(pid)`가 시그널 없이 생존 여부를 본다.

### `CLI-PID-03` 포트 상태 확인

- Trigger: start/stop/restart/status
- Main Flow:
  - `isPortInUse(port)`로 포트 바인딩 여부를 검사한다.
  - `waitForPortFree(port)`로 종료 후 포트 해제를 기다린다.

## Constraints

- `CLI-PID-C-001`: PID 파일 경로는 현재 작업 디렉터리에 고정되어야 한다.
- `CLI-PID-C-002`: stale PID 파일이 있어도 실제 프로세스 생존 여부를 추가 확인해야 한다.
- `CLI-PID-C-003`: 포트 해제 대기는 타임아웃을 가져야 한다.

## Interface

- `writePid(pid: number): void`
- `readPid(): number | null`
- `removePid(): void`
- `isProcessAlive(pid: number): boolean`
- `isPortInUse(port: number): Promise<boolean>`
- `waitForPortFree(port: number, timeoutMs?: number, intervalMs?: number): Promise<boolean>`

## Realization

- 모듈 경계:
  - `pid.ts`는 파일과 프로세스/포트 확인만 담당한다.
- 실패 처리:
  - PID 파일이 없거나 파싱 실패면 `null`을 반환해 상위 명령이 분기하게 한다.

## Dependencies

- Depends On: Node.js `fs`, `process`, `net`
- Blocks: `commands.md`
- Parallelizable With: `config-loader.md`

## AC

- Given daemon 시작 직후 When PID 파일을 읽으면 Then 방금 기록한 PID를 돌려준다.
- Given 프로세스 종료 후 When `waitForPortFree()`를 호출하면 Then 제한 시간 안에 포트 해제 여부를 확인한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

