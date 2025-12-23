## 디렉토리 개요

Slack/GitHub OAuth 자격증명 저장 계층이다. `v2_*` 테이블과 호환되도록 설계한다.

## 코드 작성 컨벤션

- 토큰은 `DATA_ENCRYPTION_KEY` 기반 AES-256-GCM으로 암호화하여 저장한다.
- `drizzle-orm`을 사용하며, 스키마는 필요한 테이블만 정의한다.

