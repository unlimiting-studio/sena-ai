#!/bin/sh
# ============================================================
# sena-platform-slack 부트스트랩 스크립트
#
# 이 스크립트는 플랫폼 웹 UI에서 봇 생성 후 사용자에게 제공됩니다.
# 필요한 인자들은 웹 UI에서 자동으로 채워져 있습니다.
#
# 사용법:
#   sh bootstrap.sh \
#     --name "my-bot" \
#     --connect-key "ck_xxxx" \
#     --platform-url "https://platform.example.com"
# ============================================================

set -e

# ── 색상 정의 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── 유틸리티 함수 ──
info()  { printf "${BLUE}[INFO]${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}[OK]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
error() { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; exit 1; }

# ── 인자 파싱 ──
BOT_NAME=""
CONNECT_KEY=""
PLATFORM_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --name)
      BOT_NAME="$2"
      shift 2
      ;;
    --connect-key)
      CONNECT_KEY="$2"
      shift 2
      ;;
    --platform-url)
      PLATFORM_URL="$2"
      shift 2
      ;;
    -h|--help)
      printf "Usage: sh bootstrap.sh --name <bot-name> --connect-key <key> --platform-url <url>\n"
      exit 0
      ;;
    *)
      error "알 수 없는 옵션: $1"
      ;;
  esac
done

# ── 필수 인자 검증 ──
if [ -z "$BOT_NAME" ]; then
  error "--name 인자가 필요합니다 (봇 이름)"
fi
if [ -z "$CONNECT_KEY" ]; then
  error "--connect-key 인자가 필요합니다 (플랫폼 연결 키)"
fi
if [ -z "$PLATFORM_URL" ]; then
  error "--platform-url 인자가 필요합니다 (플랫폼 서버 URL)"
fi

printf "\n"
printf "${CYAN}╔══════════════════════════════════════════╗${NC}\n"
printf "${CYAN}║      sena-platform-slack 봇 설정 시작       ║${NC}\n"
printf "${CYAN}╚══════════════════════════════════════════╝${NC}\n"
printf "\n"

info "봇 이름: $BOT_NAME"
info "플랫폼 URL: $PLATFORM_URL"

# ── Step 1: Node.js 버전 확인 (20 이상 필수) ──
info "Node.js 버전 확인 중..."

if ! command -v node >/dev/null 2>&1; then
  error "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 v20 이상을 설치해주세요."
fi

NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=$(printf "%s" "$NODE_VERSION" | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 20 ]; then
  error "Node.js v20 이상이 필요합니다. 현재 버전: v$NODE_VERSION"
fi

ok "Node.js v$NODE_VERSION 확인됨"

# ── Step 2: pnpm 설치 확인 ──
info "pnpm 확인 중..."

if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm이 설치되어 있지 않습니다. 설치를 시작합니다..."
  npm install -g pnpm
  if ! command -v pnpm >/dev/null 2>&1; then
    error "pnpm 설치에 실패했습니다. 수동으로 설치해주세요: npm install -g pnpm"
  fi
  ok "pnpm 설치 완료"
else
  ok "pnpm $(pnpm -v) 확인됨"
fi

# ── Step 3: 프로젝트 디렉토리 생성 ──
info "프로젝트 디렉토리 생성 중: ./$BOT_NAME"

if [ -d "$BOT_NAME" ]; then
  error "디렉토리 '$BOT_NAME'이 이미 존재합니다. 다른 이름을 사용하거나 기존 디렉토리를 삭제해주세요."
fi

mkdir -p "$BOT_NAME"
cd "$BOT_NAME"

# ── Step 4: pnpm init ──
info "프로젝트 초기화 중..."
pnpm init >/dev/null 2>&1
ok "package.json 생성됨"

# ── Step 5: 런타임 선택 (대화형 메뉴) ──
printf "\n"
printf "${CYAN}런타임을 선택해주세요:${NC}\n"
printf "  ${GREEN}1)${NC} Claude (Anthropic Claude 기반)\n"
printf "  ${GREEN}2)${NC} Codex (OpenAI Codex 기반)\n"
printf "\n"

RUNTIME_CHOICE=""
while [ -z "$RUNTIME_CHOICE" ]; do
  printf "선택 (1 또는 2): "
  read -r REPLY
  case "$REPLY" in
    1)
      RUNTIME_CHOICE="claude"
      ;;
    2)
      RUNTIME_CHOICE="codex"
      ;;
    *)
      warn "1 또는 2를 입력해주세요."
      ;;
  esac
done

ok "런타임 선택됨: $RUNTIME_CHOICE"

# ── Step 6: 패키지 설치 ──
info "패키지 설치 중... (잠시 기다려주세요)"

RUNTIME_PKG="@sena-ai/runtime-${RUNTIME_CHOICE}"

pnpm add "@sena-ai/core" "@sena-ai/cli" "$RUNTIME_PKG" "@sena-ai/platform-connector"

ok "패키지 설치 완료"

# ── Step 7: .env 파일 생성 ──
info ".env 파일 생성 중..."

cat > .env << ENVEOF
# sena-platform-slack 환경 변수
# 플랫폼 서버 URL
PLATFORM_URL=$PLATFORM_URL

# 플랫폼 연결 키 (봇 인증용)
CONNECT_KEY=$CONNECT_KEY
ENVEOF

ok ".env 파일 생성됨"

# ── Step 8: sena.config.ts 생성 ──
info "sena.config.ts 생성 중..."

if [ "$RUNTIME_CHOICE" = "claude" ]; then
  RUNTIME_IMPORT="import { claude } from '@sena-ai/runtime-claude'"
  RUNTIME_CONFIG="runtime: claude(),"
else
  RUNTIME_IMPORT="import { codex } from '@sena-ai/runtime-codex'"
  RUNTIME_CONFIG="runtime: codex(),"
fi

cat > sena.config.ts << CONFIGEOF
import { defineConfig } from '@sena-ai/core'
${RUNTIME_IMPORT}
import { platformConnector } from '@sena-ai/platform-connector'

export default defineConfig({
  ${RUNTIME_CONFIG}
  connectors: [
    platformConnector({
      platformUrl: process.env.PLATFORM_URL!,
      connectKey: process.env.CONNECT_KEY!,
      thinkingMessage: ':hourglass_flowing_sand: 생각하는 중...',
    }),
  ],
})
CONFIGEOF

ok "sena.config.ts 생성됨"

# ── Step 9: 시스템 프롬프트 생성 ──
info "시스템 프롬프트 생성 중..."

mkdir -p .sena

cat > .sena/SYSTEM.md << SYSEOF
# ${BOT_NAME}

당신은 Slack 워크스페이스에서 동작하는 AI 어시스턴트입니다.

## 기본 원칙
- 사용자의 질문에 정확하고 도움이 되는 답변을 제공합니다.
- 한국어로 대화합니다. (필요시 영어도 가능)
- 간결하지만 충분한 정보를 포함한 답변을 합니다.

## 주의사항
- 민감한 정보(비밀번호, API 키 등)는 절대 노출하지 않습니다.
- 확실하지 않은 정보는 솔직하게 모른다고 답합니다.
SYSEOF

ok "시스템 프롬프트 생성됨 (.sena/SYSTEM.md)"

# ── 완료 메시지 ──
printf "\n"
printf "${GREEN}╔══════════════════════════════════════════╗${NC}\n"
printf "${GREEN}║   봇 설정이 완료되었습니다!               ║${NC}\n"
printf "${GREEN}╚══════════════════════════════════════════╝${NC}\n"
printf "\n"
printf "${CYAN}다음 단계:${NC}\n"
printf "\n"
printf "  1. .env 파일을 열어 ANTHROPIC_API_KEY를 입력해주세요:\n"
printf "     ${YELLOW}cd %s && vi .env${NC}\n" "$BOT_NAME"
printf "\n"
printf "  2. 봇을 실행해주세요:\n"
printf "     ${YELLOW}pnpm sena start${NC}\n"
printf "\n"
printf "  3. (선택) 시스템 프롬프트를 수정하세요:\n"
printf "     ${YELLOW}vi .sena/SYSTEM.md${NC}\n"
printf "\n"
