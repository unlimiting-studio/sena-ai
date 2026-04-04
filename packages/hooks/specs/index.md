# @sena-ai/hooks

## 한 줄 요약

"sena-ai 사용자가 턴 시작과 종료 지점에 파일 컨텍스트 주입과 trace 기록을 손쉽게 추가할 수 있게 한다."

## 문제 정의

- 현재 상태:
  코어는 hook 확장 지점을 제공하지만 자주 쓰는 기본 hook은 별도 구현이 필요하다.
- Pain Point:
  파일 기반 컨텍스트 주입과 trace 기록은 반복적으로 필요한 기능인데 프로젝트마다 재구현하면 계약이 흔들린다.
- 우선순위 근거:
  hooks 패키지는 core hook 표면을 실제 운영 패턴으로 구체화하는 첫 예시다.

## 목표 & 성공 지표

- `fileContext`, `traceLogger` 두 책임이 독립 상세 스펙으로 정의된다.
- core hook 계약과 Node 파일 시스템 동작이 일관되게 문서화된다.

## 스펙 안정성 분류

- `Stable`
  - fileContext/traceLogger의 외부 계약
- `Flexible`
  - 파일명 규칙, 출력 위치의 세부 포맷
- `Experimental`
  - 현재 없음

## 스펙 안정성 분류

- `Stable`: `fileContext`/`traceLogger`의 hook 시점, 입력 옵션 의미, 출력 형태
- `Flexible`: glob 전략, 파일명 정렬 구현 세부, 로그 파일명 포맷
- `Experimental`: 현재 없음

## 용어 정의

- `TurnStartHook`: 턴 시작 전에 `ContextFragment[]`를 반환하는 훅.
- `TurnEndHook`: 턴 종료 후 추가 작업을 수행하는 훅.
- `fileContext`: 파일/디렉터리 내용을 컨텍스트로 주입하는 기본 훅.
- `traceLogger`: 턴 결과를 파일로 기록하는 기본 훅.

## 요구사항

- `HOOKS-FR-001` [Committed][Stable]: `fileContext`는 파일 또는 디렉터리 내용을 `ContextFragment[]`로 주입해야 한다.
- `HOOKS-FR-002` [Committed][Stable]: `traceLogger`는 턴 결과를 파일 시스템에 JSON으로 기록해야 한다.
- `HOOKS-NFR-001` [Committed][Stable]: 기본 hooks는 core 타입 계약만으로 동작하고 런타임 구현에 종속되지 않아야 한다.
- `HOOKS-NFR-002` [Committed][Flexible]: 파일 시스템 접근은 최소 권한으로 수행하고 실패를 숨기지 않아야 한다.

## 수용 기준 (AC)

- `HOOKS-AC-001`: Given 파일 경로 기반 `fileContext`, When 훅이 실행되면, Then 지정 role의 `ContextFragment`가 반환된다. 관련: `HOOKS-FR-001`
- `HOOKS-AC-002`: Given 디렉터리 기반 `fileContext`, When 훅이 실행되면, Then 파일명 정렬과 glob/maxLength 규칙이 적용된다. 관련: `HOOKS-FR-001`
- `HOOKS-AC-003`: Given `traceLogger`, When 턴이 성공 종료되면, Then output dir 아래에 JSON trace 파일이 생성된다. 관련: `HOOKS-FR-002`

## 의존관계 맵

- Depends On: `@sena-ai/core` hook/type 계약, Node.js 파일 시스템 접근
- Blocks: 프로젝트별 기본 context 주입과 trace 기록 패턴 재사용
- Parallelizable With: 개별 애플리케이션의 custom hook 추가 작업

## 범위 경계 (Non-goals)

- 원격 스토리지 업로드.
- 로그 회전/보관 정책.
- 디렉터리 재귀 순회.

## 제약 & 가정

- hooks 패키지는 Node 파일 시스템 접근이 가능한 환경을 전제로 한다.
- trace 파일 형식은 현재 JSON 단일 포맷만 지원한다.

## 리스크 & 완화책

- 대용량 파일 주입 리스크:
  컨텍스트가 지나치게 커질 수 있다.
  완화: `maxLength`와 glob 필터를 명시 계약으로 둔다.
- 로그 폭증 리스크:
  trace 기록이 디스크를 빠르게 점유할 수 있다.
  완화: JSON 단일 파일 출력 책임만 두고 보관 정책은 범위 밖으로 둔다.

## 검증 계획

- `packages/hooks/src/__tests__/fileContext.test.ts`, `traceLogger.test.ts`를 기준 검증 세트로 유지한다.

## 상세 스펙 맵

- [fileContext.md](/Users/channy/workspace/sena-ai/packages/hooks/specs/fileContext.md)
- [traceLogger.md](/Users/channy/workspace/sena-ai/packages/hooks/specs/traceLogger.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
