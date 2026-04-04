# @sena-ai/cli

## 한 줄 요약

"운영자가 `sena` CLI로 에이전트의 시작, 중지, 재시작, 상태 확인, 로그 조회, 프로젝트 초기화를 수행하고 코어의 Worker/Orchestrator를 안전하게 운용한다."

## 문제 정의

- 현재 상태:
  core 패키지는 실행 엔진을 제공하지만 개발자와 운영자가 직접 프로세스/포트/PID를 관리하기엔 부담이 크다.
- Pain Point:
  시작/종료/재시작/초기화 절차가 문서화되지 않으면 로컬 운영과 템플릿 부트스트랩이 일관되지 않는다.
- 우선순위 근거:
  CLI는 첫 사용자 경험과 운영 편의성을 동시에 담당한다.

## 목표 & 성공 지표

- 명령어별 선행 검증, PID 관리, 포트 결정, foreground/daemon 분기가 명확히 추적된다.
- CLI 명령 세트와 Orchestrator/Worker 아키텍처 문서가 분리된다.

## 스펙 안정성 분류

- `Stable`
  - 명령어 의미, config-loader/PID/프로세스 제어 책임
- `Flexible`
  - 출력 메시지, 템플릿 안내 문구
- `Experimental`
  - 현재 없음

## 스펙 안정성 분류

- `Stable`: 명령 집합(`start|stop|restart|status|logs|init`), PID/포트/설정 로더의 공개 동작, daemon/foreground 분기
- `Flexible`: 템플릿 초기화 세부 치환, 로그 메시지, help 출력 형식
- `Experimental`: 현재 없음

## 용어 정의

- `Foreground`: 현재 터미널 프로세스가 직접 Orchestrator를 실행하는 모드.
- `Daemon`: 백그라운드 프로세스로 재실행되는 모드.
- `PID File`: 현재 Orchestrator PID를 저장하는 `.sena.pid`.
- `Config Loader`: `.env` 로드, 설정 import, 포트 결정 책임.

## 요구사항

- `CLI-FR-001` [Committed][Stable]: `sena start|stop|restart|status|logs|init` 명령은 표준 운영 흐름을 제공해야 한다.
- `CLI-FR-002` [Committed][Stable]: CLI는 설정 파일 로드, PID 관리, 포트 점검을 공통 선행 단계로 사용해야 한다.
- `CLI-FR-003` [Committed][Stable]: start/restart는 core Orchestrator/Worker 생명주기와 호환되는 시그널/IPC 모델을 따라야 한다.
- `CLI-FR-004` [Committed][Stable]: CLI는 현재 작업 디렉터리 범위의 설정 탐색, PID 파일, 포트 상태 유틸리티를 공통 인프라로 제공해야 한다.
- `CLI-NFR-001` [Committed][Stable]: daemon/foreground 모두에서 stale PID와 포트 충돌을 안전하게 처리해야 한다.
- `CLI-NFR-002` [Committed][Flexible]: 템플릿 init은 사용자 작업을 최소화하는 기본 치환과 의존성 설치를 제공해야 한다.

## 수용 기준 (AC)

- `CLI-AC-001`: Given 기존 프로세스가 살아 있을 때, When `sena start`를 실행하면, Then 중복 기동 대신 이미 실행 중 오류를 반환한다. 관련: `CLI-FR-001`, `CLI-NFR-001`
- `CLI-AC-002`: Given daemon 모드 start, When 프로세스가 분리되면, Then 부모는 즉시 종료하고 자식은 foreground start 로직으로 동작한다. 관련: `CLI-FR-001`, `CLI-FR-003`
- `CLI-AC-003`: Given running 프로세스에 `sena restart`를 실행할 때, When 기본 모드를 쓰면, Then `SIGUSR2`로 worker rolling restart를 유도한다. 관련: `CLI-FR-003`
- `CLI-AC-004`: Given `sena init`을 실행할 때, When 템플릿 다운로드가 끝나면, Then 플레이스홀더 치환과 `pnpm install`이 자동으로 수행된다. 관련: `CLI-FR-001`, `CLI-NFR-002`

## 의존관계 맵

- Depends On: `@sena-ai/core` Orchestrator/Worker 계약, 로컬 파일 시스템, Node.js 프로세스/시그널 모델
- Blocks: 운영자 로컬 실행 경험, 템플릿 기반 새 프로젝트 부트스트랩
- Parallelizable With: 템플릿 패키지 개편, core 실행 경로 변경 없는 CLI UX 개선

## 범위 경계 (Non-goals)

- 프로덕션 프로세스 매니저(PM2, systemd) 통합.
- 원격 로그 수집.
- 템플릿 레지스트리 동적 탐색.

## 제약 & 가정

- CLI는 로컬 파일 시스템과 Node.js 프로세스 시그널 모델을 사용한다.
- 설정 파일은 JS/TS 모듈로 import 가능해야 한다.

## 리스크 & 완화책

- stale PID 리스크:
  크래시 후 PID 파일이 남으면 start/stop/status가 오판한다.
  완화: 모든 명령이 선행 생존 검사를 수행한다.
- 포트 충돌 리스크:
  기존 서비스가 포트를 사용 중이면 start가 실패한다.
  완화: config loader 단계에서 사전 확인한다.

## 검증 계획

- `packages/cli/src/__tests__/config-loader.test.ts`, `pid.test.ts`를 기본 검증 세트로 유지한다.
- 수동 검증 시 start/stop/restart/status/logs/init 각 명령을 foreground/daemon 경로로 분리해 확인한다.

## 상세 스펙 맵

- [commands.md](/Users/channy/workspace/sena-ai/packages/cli/specs/commands.md)
- [config-loader.md](/Users/channy/workspace/sena-ai/packages/cli/specs/config-loader.md)
- [orchestrator.md](/Users/channy/workspace/sena-ai/packages/cli/specs/orchestrator.md)
- [pid.md](/Users/channy/workspace/sena-ai/packages/cli/specs/pid.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
