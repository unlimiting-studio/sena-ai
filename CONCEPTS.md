# Sena 핵심 컨셉

## 프로젝트 개요

Sena는 Slack 이벤트를 수신하여 AI 에이전트(Claude 또는 Codex)를 실행하는 서버입니다. Karby 프로젝트에서 에이전트 부분을 분리한 것으로, 사용자가 Slack에서 멘션하면 AI가 대화에 참여하고, 스케줄에 따라 자동으로 작업을 수행합니다.

---

## 1. 듀얼 런타임 (Claude / Codex)

에이전트 실행 엔진을 `claude`와 `codex` 중 선택할 수 있습니다.

- **Claude 모드**: `@anthropic-ai/claude-agent-sdk`의 `query()`를 사용. MCP 서버를 SDK에 직접 전달.
- **Codex 모드**: `@openai/codex-sdk`의 `Codex` 클래스를 사용. MCP 서버는 stdio 브릿지 프로세스를 통해 연결.

`createAgentRuntimeStream()`이 두 런타임의 차이를 `AgentRuntimeEvent` 스트림으로 추상화합니다. 이벤트 타입:

| 이벤트 | 의미 |
|--------|------|
| `session.init` | 세션 ID 확정 (재개용) |
| `assistant.stream.start` | 어시스턴트 응답 시작 |
| `assistant.delta` | 스트리밍 텍스트 조각 |
| `assistant.text` | 완성된 어시스턴트 텍스트 |
| `tool.use` | 도구 호출 시작 |
| `tool.progress` | 도구 실행 중 |
| `tool.result` | 도구 실행 완료 |
| `result` | 최종 응답 |

---

## 2. Orchestrator–Worker 아키텍처

프로세스가 두 역할로 분리됩니다:

```
┌──────────────────────────────┐
│  Orchestrator (포트 3100)     │  ← 외부 트래픽 수신, Worker로 프록시
│  - WorkerManager             │
│  - 세대(generation) 관리      │
│  - 무중단 재시작              │
└──────────┬───────────────────┘
           │ HTTP proxy
┌──────────▼───────────────────┐
│  Worker (동적 포트)           │  ← 실제 비즈니스 로직
│  - Fastify 서버              │
│  - Slack 이벤트 처리          │
│  - 에이전트 스레드 실행        │
│  - 스케줄 태스크 실행          │
└──────────────────────────────┘
```

**무중단 재시작 흐름**: 새 Worker 스폰 → health 체크 → 트래픽 전환 → 이전 Worker drain → SIGTERM. 세대 번호(`generation`)로 각 Worker를 식별합니다.

---

## 3. Slack 스레드 모델

Slack에서의 대화는 **스레드 단위로 에이전트 세션이 유지**됩니다.

### 핵심 클래스

- **`SlackClaudeAgent`**: 싱글톤. 멘션 이벤트를 받아 스레드별 Runner를 관리.
- **`SlackThreadRunner`**: 스레드 하나의 생명주기. 프롬프트 큐, 턴 상태, 세션 재개를 관리.
- **`SlackThreadOutput`**: Slack 메시지 업데이트 (thinking 인디케이터, 프로그레스, 최종 응답).
- **`SlackThreadProgress`**: 도구 사용/텍스트 진행 상황을 렌더링.

### 턴 상태 머신

```
idle → active → finalizing → idle
```

- **idle**: 입력 대기. 새 메시지가 들어오면 `active`로 전환.
- **active**: 에이전트 실행 중. 도구 호출과 텍스트 스트리밍을 Slack에 반영.
- **finalizing**: 최종 응답을 Slack에 기록하고 `idle`로 복귀.

### 프롬프트 큐 (`AsyncUserMessageQueue`)

사용자 메시지를 비동기 이터러블로 에이전트에 전달합니다. 에이전트가 한 턴을 끝내면 큐에서 다음 메시지를 꺼내 자연스러운 멀티턴 대화가 됩니다.

### 세션 재개

`sessionId`를 디스크에 저장(`ThreadSessionStore`)하여, Runner가 재생성되어도 이전 대화 맥락을 이어갑니다.

---

## 4. MCP (Model Context Protocol) 도구 체계

에이전트가 사용할 수 있는 도구를 MCP 서버로 제공합니다.

### 내장 MCP 서버

| 서버 | 도구 | 설명 |
|------|------|------|
| **slack** | `get_messages`, `list_channels`, `post_message`, `download_file`, `upload_file` | Slack 읽기/쓰기 |
| **obsidian** | `list_notes`, `read_note`, `search_notes`, `write_note` | Obsidian 노트 (CouchDB LiveSync 경유) |
| **context7** | (외부) | 라이브러리 문서 조회 |

### Claude vs Codex MCP 연결 방식

- **Claude**: MCP 서버 객체를 SDK `mcpServers` 옵션에 직접 전달.
- **Codex**: Worker 프로세스를 `--mcp-server slack` 인자로 재실행해 stdio 기반 MCP 브릿지를 구성.

### 외부 MCP 서버

`sena.yaml`의 `mcpServers`에 HTTP 또는 stdio 타입으로 추가 MCP 서버를 설정할 수 있습니다. 헤더에 `{{ENV_VAR}}` 패턴으로 환경 변수를 주입합니다.

---

## 5. 스케줄 태스크 (Cronjob / Heartbeat)

에이전트가 주기적으로 자동 실행되는 두 가지 방식:

- **Cronjob**: 5필드 cron 표현식. 지정된 시각에 프롬프트를 실행.
- **Heartbeat**: N분 간격으로 프롬프트를 실행. 응답에 `HEARTBEAT_OK`가 포함되면 외부 알림을 억제(저소음 모드).

스케줄러는 매초 현재 시각(서울 타임존)을 체크하여 매칭되는 태스크를 실행합니다. 각 태스크는 독립적인 에이전트 런타임 스트림으로 실행되며 세션 재개 없이 1회성으로 동작합니다.

---

## 6. 워크스페이스 컨텍스트 (`.sena/` 디렉터리)

에이전트의 성격과 지식을 파일 기반으로 관리합니다.

| 파일 | 용도 |
|------|------|
| `AGENTS.md` | 에이전트 행동 지침 |
| `SOUL.md` | 에이전트 성격/페르소나 |
| `IDENTITY.md` | 정체성 정의 |
| `USER.md` | 사용자 정보 |
| `TOOLS.md` | 도구 사용 가이드 |
| `memory/` | 장기 기억 파일들 |
| `daily/` | 일별 기억 파일들 |
| `HEARTBEAT.md` | 하트비트 실행 지침 |
| `DO_EVERY_HOUR.md` | 매시 실행 지침 |

이 파일들은 시스템 프롬프트에 합쳐져 에이전트에게 전달됩니다. 큰 파일은 자동으로 잘리며 truncation 마커가 붙습니다.

---

## 7. 설정 체계

설정은 세 레이어로 구성됩니다:

1. **`sena.yaml`** (또는 `sena.yml` / `sena.jsonc`): 에이전트 이름, 런타임 모드, 모델, MCP 서버, 스케줄, 베이스 프롬프트.
2. **환경 변수**: API 키, DB 연결, 포트 등. 동일 항목은 환경 변수가 `sena.yaml`보다 우선.
3. **`CONFIG` 객체** (`src/config.ts`): 환경 변수를 파싱하여 타입 안전한 설정값으로 제공.

`sena.yaml` 내 `{{VAR_NAME}}` 패턴은 런타임에 환경 변수로 치환됩니다.

---

## 8. Slack 이벤트 처리 파이프라인

```
Slack Events API
  → POST /api/slack/events
  → HMAC-SHA256 서명 검증
  → event_id 기반 중복 제거 (TTL 1시간)
  → 이벤트 타입 분기
     ├─ app_mention → SlackClaudeAgent.handleMention()
     │   → 이미지 메타데이터 준비
     │   → SlackThreadRunner 생성 또는 재사용
     │   → 프롬프트 큐에 메시지 추가
     │   → 에이전트 실행 → Slack 메시지 업데이트
     │
     └─ reaction_added (❌) → handleReactionStop()
         → 해당 스레드의 Runner 중지
```

### 프로그레스 업데이트 쓰로틀링

Slack API 부하를 줄이기 위해 프로그레스 업데이트를 **최소 3초 간격**으로 제한합니다. 타이머 기반으로 업데이트를 큐잉하고, 턴이 끝나면 즉시 최종 응답을 반영합니다.

---

## 9. 주요 설계 결정

- **AsyncIterable 기반 스트리밍**: 런타임 이벤트, 프롬프트 큐 모두 `AsyncGenerator`/`AsyncIterable`로 구현. 백프레셔가 자연스럽게 적용됨.
- **세션 영속성**: 디스크에 세션 ID를 저장하여 프로세스 재시작 후에도 대화를 이어갈 수 있음.
- **MCP 브릿지 패턴**: Codex SDK가 MCP를 네이티브 지원하지 않으므로, Worker 바이너리를 stdio MCP 서버로 재활용하여 브릿지 구성.
- **Idle 타임아웃**: 15분간 입력이 없으면 Runner를 자동 종료하여 리소스를 회수.
- **Generation 기반 Worker 관리**: 세대 번호로 Worker를 구분하고, health 체크로 준비 상태를 확인한 후에만 트래픽을 전환.
