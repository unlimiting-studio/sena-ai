# Slack Output Accumulation

> 에이전트의 중간 출력을 누적 표시하여 사용자가 전체 과정을 확인할 수 있도록 한다.

## 현재 문제

1. `showProgress(text)` → thinking 메시지를 **덮어쓰기** → 이전 내용 소실
2. `sendResult(text)` → thinking 메시지 삭제 → 최종 결과만 새 메시지로 전송
3. 에이전트가 여러 단계를 거쳐도 사용자는 마지막 응답만 볼 수 있음

## 설계 결정

### Core 인터페이스 변경 없음

Codex 리뷰를 반영하여 `ConnectorOutput` 인터페이스를 변경하지 않음.
모든 누적 로직은 **Slack 커넥터 내부**에서 처리.

- `showProgress(text)` 호출 시 내부적으로 스텝 전환 감지 + 누적
- 다른 커넥터에 영향 없음
- Worker는 단순히 progress text를 전달하는 역할만

### 스텝 감지 방식

Worker가 `progressText`를 누적하여 항상 전체 텍스트를 `showProgress`에 전달:
- `progress` 이벤트: 전체 교체 (각 assistant 메시지 = 새 스텝)
- `progress.delta` 이벤트: 기존 텍스트에 append (스트리밍)

커넥터 내부의 `isNewStep()`: 새 텍스트가 이전 텍스트로 시작하지 않으면 = 새 스텝
- `progress` (교체): 완전히 다른 텍스트 → 새 스텝 ✓
- `progress.delta` (누적): 이전 텍스트 + 추가 → 같은 스텝 ✓

## 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/core/src/worker.ts` | `onEvent`에서 `progressText` 누적 후 full text로 `showProgress` 호출 |
| `packages/connector-slack/src/connector.ts` | `createSlackOutput` 전면 리디자인 |

## 구현 상세

### Worker 변경 (worker.ts)

```typescript
// IIFE로 progressText 클로저 생성
onEvent: (() => {
  if (!output) return undefined
  let progressText = ''
  return (evt: RuntimeEvent) => {
    if (evt.type === 'progress') {
      progressText = evt.text      // 전체 교체
      output.showProgress(progressText)
    } else if (evt.type === 'progress.delta') {
      progressText += evt.text     // 누적
      output.showProgress(progressText)
    }
  }
})(),
```

이전 코드는 `progress.delta`의 raw delta(몇 글자)를 그대로 전달해서 showProgress가 무의미한 짧은 텍스트를 표시하는 버그가 있었음.

### Slack 커넥터 (connector.ts)

**상태:**
- `completedSteps: string[]` — 확정된 스텝 텍스트
- `currentText: string` — 현재 진행 중인 텍스트
- `activeTs: string` — 업데이트 중인 Slack 메시지 ts
- `frozenStepCount: number` — 이전 메시지에 동결된 스텝 수

**API 직렬화:**
Promise 체인(`enqueue`)으로 모든 Slack API 호출을 직렬화하여 경쟁 조건 방지.

**렌더링:**
스텝들을 `---` 구분자로 합치고 `markdownToSlack()`으로 렌더링.
기존 mrkdwn.ts가 섹션 분할(3000자), 테이블 1개 제한을 처리.

**오버플로우:**
- 45블록 초과 시 → 기존 메시지를 freeze → 새 메시지 생성
- 단일 스텝이 45블록 초과 시 → blocks 없이 fallback text로 전송 (무한 루프 방지)

**sendResult:**
- 마지막 progress text와 result text의 trim 비교로 중복 방지
- 스텝이 1개뿐이면 단순 메시지, 여러 스텝이면 누적 렌더링

## Codex 리뷰 반영사항

1. ✅ Core 인터페이스 변경 없음 (커넥터 내부 누적)
2. ✅ API 호출 직렬화 (enqueue 패턴)
3. ✅ 오버플로우 시 기존 메시지 freeze
4. ✅ 단일 스텝 오버플로우 가드 (blocks 제거 fallback)
5. ✅ sendResult dedup에 trim 비교
6. ✅ sendResult/sendError 실패 시 console.error
