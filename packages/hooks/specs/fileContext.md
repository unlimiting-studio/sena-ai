# fileContext

## 한 줄 요약

`fileContext()`는 파일 또는 디렉터리 내용을 읽어 턴 컨텍스트에 주입하는 `onTurnStart` 콜백이다.

## 상위 스펙 연결

- 관련 요구사항: `HOOKS-FR-001`, `HOOKS-NFR-001`, `HOOKS-NFR-002`
- 관련 수용 기준: `HOOKS-AC-001`, `HOOKS-AC-002`

## Behavior

- Trigger:
  Turn Engine이 `onTurnStart` 훅으로 `fileContext`를 실행한다.
- Main Flow:
  1. `when`이 있으면 현재 `TurnContext`로 실행 여부를 먼저 판정한다.
  2. path가 파일이면 해당 파일을 읽어 하나의 fragment를 만든다.
  3. path가 디렉터리면 하위 파일만 모아 파일명 기준 정렬 후 각각 fragment를 만든다.
  4. `glob`가 있으면 파일명을 필터링한다.
  5. `maxLength`가 있으면 내용을 앞에서부터 자른다.
- Failure Modes:
  파일 시스템 오류는 훅 실패로 상위에 전파된다.

## Constraints

- `HOOKS-FILE-CON-001`: 디렉터리 모드에서 하위 디렉터리는 무시해야 한다.
- `HOOKS-FILE-CON-002`: fragment `source`는 `file:{파일명}` 형식이어야 한다.
- `HOOKS-FILE-CON-003`: 훅 `name`은 `fileContext:{path}` 형식이어야 한다.

## Interface

- API:
  `fileContext(options: FileContextOptions): TurnStartCallback`
- 옵션:
  `path`, `as`, `glob?`, `when?`, `maxLength?`

## Realization

- 단일 파일과 디렉터리 모드를 하나의 훅 팩토리에서 처리한다.
- glob는 단순 패턴(`*.ext` 또는 정확한 이름)만 지원한다.

## Dependencies

- Depends On:
  [@sena-ai/core types](/Users/channy/workspace/sena-ai/packages/core/specs/types.md), [Turn Engine](/Users/channy/workspace/sena-ai/packages/core/specs/turn-engine.md)
- Blocks:
  파일 기반 컨텍스트 주입 경로
- Parallelizable With:
  trace 로깅

## AC

- Given 파일 경로와 `as: 'system'`, When 훅이 실행되면, Then `{ decision: 'allow', fragments: [{ role: 'system', ... }] }`가 반환된다.
- Given 파일 경로와 `as: 'prepend'`, When 훅이 실행되면, Then fragment의 role이 `'prepend'`이다.
- Given 파일 경로와 `as: 'append'`, When 훅이 실행되면, Then fragment의 role이 `'append'`이다.
- Given 디렉터리 경로와 glob, When 훅이 실행되면, Then 정렬된 파일들만 fragment로 반환된다.
- Given `when`이 false를 반환할 때, When 훅이 실행되면, Then `{ decision: 'allow' }` (fragments 없음)를 반환한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

