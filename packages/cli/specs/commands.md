# CLI Commands

## 한 줄 요약

CLI 명령 세트는 에이전트 운영과 프로젝트 부트스트랩을 위한 표준 사용자 인터페이스다.

## 상위 스펙 연결

- 관련 요구사항: `CLI-FR-001`, `CLI-FR-002`, `CLI-NFR-001`, `CLI-NFR-002`
- 관련 수용 기준: `CLI-AC-001`, `CLI-AC-002`, `CLI-AC-003`, `CLI-AC-004`

## Behavior

- Trigger:
  사용자가 `sena` 하위 명령을 호출한다.
- Main Flow:
  1. 공통 글로벌 옵션으로 config 경로를 결정한다.
  2. `start`는 config loader, PID 검사, 포트 검사 후 foreground 또는 daemon 경로로 실행한다.
  3. `stop`은 PID 대상 프로세스에 `SIGTERM`, 필요 시 `SIGKILL`을 보낸다.
  4. `restart`는 기본적으로 `SIGUSR2`를 보내고 `--full`이면 stop 후 daemon start를 수행한다.
  5. `status`는 PID와 `/health` 응답으로 상태를 판정한다.
  6. `logs`는 `tail` 기반으로 daemon 로그를 출력한다.
  7. `init`은 템플릿 다운로드, 치환, `.env` 준비, `pnpm install`을 수행한다.
- Failure Modes:
  PID 없음, stale PID, 포트 사용 중, 템플릿 이름 오류, 로그 파일 없음은 명확한 오류 메시지로 종료한다.

## Constraints

- `CLI-CMD-CON-001`: 모든 프로세스 제어 명령은 `.sena.pid`를 단일 출처로 사용해야 한다.
- `CLI-CMD-CON-002`: daemon start는 부모 프로세스를 즉시 반환시켜야 한다.
- `CLI-CMD-CON-003`: `status`는 프로세스 생존과 HTTP health를 구분해서 표현해야 한다.
- `CLI-CMD-CON-004`: `init`은 템플릿 플레이스홀더와 `.env.template` rename을 자동 처리해야 한다.

## Interface

- 명령:
  `start`, `stop`, `restart`, `status`, `logs`, `init`
- 글로벌 옵션:
  `-c, --config <path>`, `-V, --version`, `-h, --help`
- 명령별 옵션:
  `--daemon`, `--full`, `--follow`, `--no-follow`, `--lines`, `--template`

## Realization

- 명령 구현은 `commands/*.ts`에 분리한다.
- 공통 로딩은 `config-loader.ts`, PID 보조는 `pid.ts`, worker 진입점은 `worker-entry.ts`에 둔다.

## Dependencies

- Depends On:
  [orchestrator.md](/Users/channy/workspace/sena-ai/packages/cli/specs/orchestrator.md), [@sena-ai/core](/Users/channy/workspace/sena-ai/packages/core/specs/index.md)
- Blocks:
  사용자 운영 UX 전반
- Parallelizable With:
  템플릿 유지보수

## AC

- Given 실행 중인 PID 파일이 살아 있을 때, When `sena start`를 실행하면, Then 새 프로세스를 띄우지 않고 이미 실행 중 오류를 반환한다.
- Given daemon start, When 부모가 자식을 detach하면, Then 자식 로그는 `sena.log`로 리다이렉트된다.
- Given `sena restart --full`, When 이전 인스턴스가 종료되면, Then 포트가 해제된 후 새 daemon 인스턴스를 기동한다.
- Given `sena init <name>`, When 템플릿 적용이 끝나면, Then 설정/패키지 이름 치환과 의존성 설치가 완료된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

