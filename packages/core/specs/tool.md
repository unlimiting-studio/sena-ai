# Tool

## 한 줄 요약

`defineTool()`과 `toolResult()`는 인라인 도구 정의와 멀티모달 결과 반환을 위한 공통 포트 계약을 제공한다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-007`, `CORE-FR-008`
- 관련 수용 기준: `CORE-AC-002`

## Behavior

- Trigger:
  사용자가 인라인 도구를 정의하거나 런타임이 도구 결과를 직렬화한다.
- Main Flow:
  1. `defineTool()`은 이름, 설명, params, handler로 `InlineToolPort`를 만든다.
  2. `params`가 있으면 JSON Schema로 변환한다.
  3. `params`가 없으면 빈 object 스키마를 사용한다.
  4. `toolResult()`는 text/image 콘텐츠 배열을 브랜딩한다.
  5. `isBrandedToolResult()`는 런타임이 멀티모달 결과를 식별하게 해준다.

## Constraints

- `CORE-TOOL-CON-001`: 반환 포트의 `type`은 항상 `inline`이어야 한다.
- `CORE-TOOL-CON-002`: 빈 params는 빈 object JSON Schema로 표현되어야 한다.
- `CORE-TOOL-CON-003`: 브랜디드 결과는 Symbol 기반으로 식별 가능해야 한다.

## Interface

- API:
  `defineTool(options: DefineToolOptions): InlineToolPort`
  `toolResult(content: ToolContent[]): BrandedToolResult`
  `isBrandedToolResult(value): value is BrandedToolResult`
  `paramsToJsonSchema(params): Record<string, unknown>`

## Realization

- Zod raw shape를 JSON Schema로 변환해 런타임과 MCP 브리지에서 재사용한다.
- 결과 브랜딩은 런타임이 string/object와 구분할 수 있는 최소 표면만 제공한다.

## Dependencies

- Depends On:
  Zod, [types.md](/Users/channy/workspace/sena-ai/packages/core/specs/types.md)
- Blocks:
  모든 인라인 도구 정의 경로
- Parallelizable With:
  MCP 도구 정의

## AC

- Given params가 없는 인라인 도구, When `defineTool()`을 호출하면, Then 빈 object input schema가 생성된다.
- Given params가 있는 도구, When `defineTool()`을 호출하면, Then JSON Schema가 포함된 `InlineToolPort`가 반환된다.
- Given `toolResult()`가 생성한 결과, When `isBrandedToolResult()`를 호출하면, Then true를 반환한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

