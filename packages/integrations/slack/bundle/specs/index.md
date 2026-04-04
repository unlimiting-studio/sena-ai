# @sena-ai/slack

## 한 줄 요약

Slack connector와 Slack tools를 하나의 진입점으로 재노출하는 편의 번들 패키지다.

## 문제 정의

- 대부분의 Slack 통합 사용자는 connector와 tools를 같이 필요로 하지만, 패키지를 따로 import 하면 조합 지점을 계속 반복하게 된다.

## 목표 & 성공 지표

- 단일 import로 Slack connector와 tools를 함께 사용할 수 있다.
- 번들 패키지는 자체 동작이 아닌 export surface를 명확히 문서화한다.

## 스펙 안정성 분류

- `Stable`: 재노출되는 public symbol 목록
- `Flexible`: 문서 예제와 설명 문구

## 용어 정의

- `Bundle`: 별도 동작 없이 하위 패키지 public symbol을 재노출하는 패키지.

## 요구사항

- `SLACK-BUNDLE-FR-001 [Committed][Stable]`: connector-slack과 tools-slack public API를 단일 패키지에서 re-export 해야 한다.
- `SLACK-BUNDLE-NFR-001 [Committed][Stable]`: 번들 자체는 추가 런타임 동작을 만들면 안 된다.

## 수용 기준 (AC)

- `SLACK-BUNDLE-AC-001`: Given `@sena-ai/slack`를 import 할 때 When connector와 tools symbol을 확인하면 Then 하위 패키지 public API가 그대로 노출된다.

## 범위 경계 (Non-goals)

- 하위 패키지에 없는 새로운 Slack 기능 추가
- 별도 런타임 상태나 부수효과 생성

## 제약 & 가정

- 실제 동작은 `connector-slack`, `tools-slack`가 제공한다고 가정한다.

## 리스크 & 완화책

- export drift 리스크:
  하위 패키지 public API와 번들 export가 어긋날 수 있다.
  완화: 번들 상세 스펙을 public symbol 목록에만 한정한다.

## 검증 계획

- source review로 `src/index.ts` 재-export 목록과 상세 스펙 일치를 확인한다.

## 상세 스펙

- [exports.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/bundle/specs/exports.md)

## 개편 메모

- AGENTS.md 가이드에 맞춰 상위 스펙 필수 섹션과 상세 스펙 링크를 정렬했다.
- 구현 계약은 바꾸지 않고 재노출 범위와 검증 기준만 문서화했다.
