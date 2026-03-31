#!/bin/bash
# ============================================================
# Claude Code Teams + tmux 스타터킷 - 초기 환경 설정 스크립트
# 사용법: ./scripts/setup.sh
# ============================================================

set -e

# Homebrew PATH 추가 (Apple Silicon)
export PATH="/opt/homebrew/bin:$PATH"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}  Claude Teams + tmux 스타터킷 설정  ${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

# ============================================================
# 1. 의존성 확인
# ============================================================
echo -e "${YELLOW}[1/5] 의존성 확인 중...${NC}"

MISSING_DEPS=0

# claude CLI 확인
if command -v claude &>/dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null | head -1 || echo "버전 확인 불가")
    echo -e "  ${GREEN}✓${NC} claude CLI: $CLAUDE_VERSION"
else
    echo -e "  ${RED}✗${NC} claude CLI: 미설치"
    echo "    설치 방법: https://claude.ai/code 에서 Claude Code 설치"
    MISSING_DEPS=1
fi

# tmux 확인
if command -v tmux &>/dev/null; then
    TMUX_VERSION=$(tmux -V 2>/dev/null || echo "버전 확인 불가")
    echo -e "  ${GREEN}✓${NC} tmux: $TMUX_VERSION"
else
    echo -e "  ${RED}✗${NC} tmux: 미설치"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "    설치 방법: brew install tmux"
    else
        echo "    설치 방법: sudo apt-get install tmux  (또는 패키지 매니저 사용)"
    fi
    MISSING_DEPS=1
fi

# jq 확인
if command -v jq &>/dev/null; then
    JQ_VERSION=$(jq --version 2>/dev/null || echo "버전 확인 불가")
    echo -e "  ${GREEN}✓${NC} jq: $JQ_VERSION"
else
    echo -e "  ${RED}✗${NC} jq: 미설치"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "    설치 방법: brew install jq"
    else
        echo "    설치 방법: sudo apt-get install jq"
    fi
    MISSING_DEPS=1
fi

if [ $MISSING_DEPS -eq 1 ]; then
    echo ""
    echo -e "${RED}필수 도구가 누락되었습니다. 위 안내에 따라 설치 후 다시 실행하세요.${NC}"
    exit 1
fi

# ============================================================
# 2. 디렉토리 구조 생성
# ============================================================
echo ""
echo -e "${YELLOW}[2/5] 디렉토리 구조 생성 중...${NC}"

mkdir -p "$PROJECT_DIR/workspace/shared"
mkdir -p "$PROJECT_DIR/logs"
touch "$PROJECT_DIR/workspace/.gitkeep"
touch "$PROJECT_DIR/workspace/shared/.gitkeep"
touch "$PROJECT_DIR/logs/.gitkeep"
echo -e "  ${GREEN}✓${NC} workspace/ 생성"
echo -e "  ${GREEN}✓${NC} workspace/shared/ 생성"
echo -e "  ${GREEN}✓${NC} logs/ 생성"

# ============================================================
# 3. 스크립트 실행 권한 부여
# ============================================================
echo ""
echo -e "${YELLOW}[3/5] 스크립트 실행 권한 부여 중...${NC}"

chmod +x "$PROJECT_DIR/scripts/"*.sh
echo -e "  ${GREEN}✓${NC} scripts/*.sh 권한 설정 완료"

# ============================================================
# 4. git 초기화 (아직 git 저장소가 아닌 경우)
# ============================================================
echo ""
echo -e "${YELLOW}[4/5] git 저장소 확인 중...${NC}"

if [ ! -d "$PROJECT_DIR/.git" ]; then
    cd "$PROJECT_DIR"
    git init -q
    echo -e "  ${GREEN}✓${NC} git 저장소 초기화"
else
    echo -e "  ${GREEN}✓${NC} git 저장소 이미 존재"
fi

# .gitignore 확인
if [ -f "$PROJECT_DIR/.gitignore" ]; then
    echo -e "  ${GREEN}✓${NC} .gitignore 존재"
fi

# ============================================================
# 5. 환경변수 설정 안내
# ============================================================
echo ""
echo -e "${YELLOW}[5/5] 환경변수 설정 안내...${NC}"

if echo "$CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" | grep -q "1" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 이미 설정됨"
else
    echo -e "  ${YELLOW}!${NC} Claude Code Agent Teams 기능을 활성화하려면 다음을 실행하세요:"
    echo ""

    SHELL_PROFILE=""
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_PROFILE="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
        SHELL_PROFILE="$HOME/.bash_profile"
    fi

    if [ -n "$SHELL_PROFILE" ]; then
        echo "    echo 'export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1' >> $SHELL_PROFILE"
        echo "    source $SHELL_PROFILE"
    else
        echo "    export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1"
        echo "    (셸 프로파일 파일에 추가하여 영구 설정하세요)"
    fi
    echo ""
    echo -e "  ${YELLOW}참고:${NC} .claude/settings.json에 이미 설정되어 있어 claude 실행 시 자동으로 적용됩니다."
fi

# ============================================================
# 완료 메시지
# ============================================================
echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  설정 완료!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "다음 명령어로 시작하세요:"
echo ""
echo -e "  ${BLUE}# 대화형 팀 시작 (tmux 세션)${NC}"
echo "  ./scripts/team-start.sh web-dev my-project"
echo ""
echo -e "  ${BLUE}# 비대화형 병렬 실행 (자동화)${NC}"
echo "  ./scripts/team-run.sh web-dev \"TODO 앱 만들기\""
echo ""
echo -e "  ${BLUE}# 사용 가능한 템플릿${NC}"
echo "  web-dev      웹 개발 (프론트엔드/백엔드/QA)"
echo "  code-review  코드 리뷰 (보안/성능/품질)"
echo "  full-cycle   풀사이클 (PM/기획/설계/개발/QA)"
echo ""
echo "자세한 내용: README.md"
