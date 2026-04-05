# @sena-ai/slack-mrkdwn

## 한 줄 요약

Slack connector와 tools가 공용으로 사용하는 safe mode Markdown 변환 패키지다.

## 문제 정의

- connector와 tools가 각자 Markdown 변환 로직을 가지면 safe mode 정책, escape 규칙, table fallback, 테스트 범위가 쉽게 드리프트한다.
- Slack 기본 auto parsing에 기대면 의도치 않은 mention, 이름 변경 취약성, 환경별 렌더링 차이 같은 운영 리스크가 생긴다.
- Slack 최신 블록 제약과 예외 케이스를 한 곳에서 추적하지 않으면 수정 비용이 커진다.

## 목표 & 성공 지표

- Slack Markdown 변환 책임을 하나의 공용 패키지로 모은다.
- connector와 tools가 동일한 safe mode payload 계약을 사용한다.
- explicit Slack token, escape, table fallback, section 분할 규칙을 하나의 테스트 셋으로 검증한다.

## 스펙 안정성 분류

- `Stable`
  - 기본 safe mode 정책
  - public API (`markdownToMrkdwn`, `markdownToSlack`, payload shape)
  - explicit Slack token 보존 규칙
  - table block 1개 제한과 fallback 의미
- `Flexible`
  - 내부 placeholder 전략, 세그먼트 분리 알고리즘, 테스트 fixture 구성
- `Experimental`
  - safe mode를 유지하는 범위의 고급 Block Kit 확장

## 용어 정의

- `safe mode`: Slack auto parsing에 기대지 않고, 명시적 Slack token만 링크/멘션/채널/유저그룹/특수 mention으로 해석되는 렌더링 정책.
- `explicit Slack token`: `<@U…>`, `<#C…>`, `<!subteam^S…>`, `<!here>`, `<https://...>` 같은 Slack 고유 표기.
- `fallback text`: Block Kit payload와 함께 제공하는 top-level `text`.

## 요구사항

- `SLACK-MR-FR-001 [Committed][Stable]`: 패키지는 `markdownToMrkdwn(md: string): string`과 `markdownToSlack(md: string): SlackMessagePayload`를 제공해야 한다.
- `SLACK-MR-FR-002 [Committed][Stable]`: 기본 렌더링은 safe mode여야 하며 Slack 자동 파싱에 의존하면 안 된다.
- `SLACK-MR-FR-003 [Committed][Stable]`: explicit Slack token은 변환 과정에서 손상되거나 escape되면 안 된다.
- `SLACK-MR-FR-004 [Committed][Stable]`: Markdown 텍스트의 `&`, `<`, `>`는 코드 블록과 explicit Slack token 바깥에서 Slack 규칙에 맞게 escape해야 한다.
- `SLACK-MR-FR-005 [Committed][Stable]`: Markdown table이 있을 때 첫 table만 Slack `table` block으로 변환하고, 추가 table은 안전한 fallback으로 렌더링해야 한다.
- `SLACK-MR-FR-006 [Committed][Stable]`: mrkdwn text object를 사용하는 block은 기본적으로 `verbatim: true`를 사용해야 한다.
- `SLACK-MR-FR-008 [Committed][Stable]`: 반환 payload는 no-table 경로에서도 safe mode를 강제할 수 있도록 Slack 전송 옵션(`parse`, `link_names`, `unfurl_links`, `unfurl_media`)을 함께 포함해야 한다.
- `SLACK-MR-FR-007 [Committed][Stable]`: connector와 tools는 이 공용 패키지를 통해 동일한 변환 계약을 사용해야 한다.
- `SLACK-MR-NFR-001 [Committed][Stable]`: safe mode 회귀는 단일 테스트 스위트로 검증 가능해야 한다.

## 수용 기준 (AC)

- `SLACK-MR-AC-001`: Given 일반 Markdown이 있을 때 When `markdownToMrkdwn()`을 호출하면 Then safe mode 문자열이 반환된다.
- `SLACK-MR-AC-002`: Given explicit Slack token이 포함된 Markdown이 있을 때 When 변환하면 Then 토큰이 보존된다.
- `SLACK-MR-AC-003`: Given `@name` 또는 `#channel` 같은 일반 문자열이 있을 때 When 변환하면 Then Slack auto parsing에 기대지 않는 plain text로 남는다.
- `SLACK-MR-AC-004`: Given table이 포함된 Markdown이 있을 때 When `markdownToSlack()`을 호출하면 Then 첫 table은 table block, 추가 table은 fallback section으로 변환된다.
- `SLACK-MR-AC-005`: Given table 주변 텍스트가 있을 때 When block payload를 만들면 Then mrkdwn text object는 `verbatim: true`로 렌더링된다.
- `SLACK-MR-AC-007`: Given table이 없는 일반 메시지일 때 When `markdownToSlack()`을 호출하면 Then payload는 safe mode 전송 옵션(`parse: 'none'`, `link_names: false`, `unfurl_links: false`, `unfurl_media: false`)을 포함한다.
- `SLACK-MR-AC-006`: Given connector와 tools가 같은 Markdown 입력을 사용할 때 When 각각 payload를 생성하면 Then 동일한 safe mode semantics를 가진다.

## 범위 경계 (Non-goals)

- Slack 메시지 조회 parser 책임
- 사용자/채널 이름을 Slack ID로 resolve하는 API 호출
- connector 출력 큐나 tool catalog 자체

## 제약 & 가정

- Slack Web API/Block Kit 규약을 따른다.
- safe mode에서는 이름 문자열 기반 auto mention/auto channel link를 지원하지 않는다.
- entity resolve는 별도 도구 또는 상위 계층이 담당한다.

## 리스크 & 완화책

- `Risk`: AI가 여전히 `@name` 같은 일반 문자열을 출력할 수 있다.
  - `완화`: safe mode에서 plain text로 유지하고, 상위 계층 문서/프롬프트에서 explicit Slack token 사용을 강제한다.
- `Risk`: 공용 패키지 도입 시 connector/tools 빌드 참조가 꼬일 수 있다.
  - `완화`: workspace package와 TS project reference를 명시하고 단일 테스트 진입점을 둔다.
- `Risk`: 정규식 기반 변환이 Slack edge case를 놓칠 수 있다.
  - `완화`: 공용 패키지에서 테스트를 집중 관리하고, 필요 시 AST 기반으로 교체 가능한 public API를 고정한다.

## 검증 계획

- 단위 테스트로 safe mode escape, explicit Slack token 보존, table fallback, section `verbatim: true`를 검증한다.
- connector와 tools smoke test로 같은 입력이 같은 semantics를 만드는지 검증한다.

## 상세 스펙

- [conversion.md](./conversion.md)
