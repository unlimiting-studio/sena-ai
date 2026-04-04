# Slack Bundle Exports

## 한 줄 요약

Slack bundle은 connector-slack과 tools-slack의 공개 심벌을 재노출하는 얇은 조립층이다.

## 상위 스펙 연결

- Related Requirements: `SLACK-BUNDLE-FR-001`, `SLACK-BUNDLE-NFR-001`
- Related AC: `SLACK-BUNDLE-AC-001`

## Behavior

- `connector-slack`에서:
  - `slackConnector`
  - `SlackConnectorOptions`
- `tools-slack`에서:
  - `slackTools`
  - `SlackToolsOptions`
  - `ALLOWED_SLACK_TOOLS`

## Constraints

- 번들 패키지는 독자적인 상태나 부수효과를 가지지 않는다.
- 재노출 심벌은 하위 패키지 public API와 동일해야 한다.

## Interface

- `import { slackConnector, slackTools } from '@sena-ai/slack'`

## Realization

- `src/index.ts`는 재-export만 수행한다.

## Dependencies

- Depends On: [connector index](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/index.md), [tools index](/Users/channy/workspace/sena-ai/packages/integrations/slack/tools/specs/index.md)
- Blocks: Slack 통합 사용성 향상

## AC

- Given 번들 패키지를 import 할 때 When connector/tools 심벌을 사용하면 Then 하위 패키지를 직접 import 한 것과 같은 계약으로 동작한다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 번들 export의 책임 경계와 추적 가능성을 명시했다.
