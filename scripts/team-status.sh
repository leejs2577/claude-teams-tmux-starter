#!/bin/bash
# ============================================================
# Claude Code Teams + tmux 스타터킷 - 팀 상태 확인 스크립트
# 사용법: ./scripts/team-status.sh [프로젝트명]
#
# 예시:
#   ./scripts/team-status.sh              # 모든 claude-team 세션 목록
#   ./scripts/team-status.sh my-app       # 특정 프로젝트 상태
# ============================================================

# Homebrew PATH 추가 (Apple Silicon)
export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_NAME="${1:-}"

# ============================================================
# tmux 확인
# ============================================================
if ! command -v tmux &>/dev/null; then
    echo -e "${RED}tmux가 설치되지 않았습니다.${NC}"
    echo "설치 방법: brew install tmux"
    exit 1
fi

# ============================================================
# 프로젝트명 없이 실행 시 - 전체 세션 목록
# ============================================================
if [ -z "$PROJECT_NAME" ]; then
    echo -e "${BLUE}=====================================${NC}"
    echo -e "${BLUE}  Claude Team 세션 목록${NC}"
    echo -e "${BLUE}=====================================${NC}"
    echo ""

    # claude-team- 으로 시작하는 세션 목록
    SESSIONS=$(tmux list-sessions 2>/dev/null | grep "claude-team-" || echo "")

    if [ -z "$SESSIONS" ]; then
        echo -e "${YELLOW}실행 중인 팀 세션이 없습니다.${NC}"
        echo ""
        echo "팀 시작 방법:"
        echo "  ./scripts/team-start.sh web-dev my-project"
    else
        echo "실행 중인 세션:"
        echo "$SESSIONS" | while IFS= read -r session; do
            SESSION_NAME=$(echo "$session" | cut -d':' -f1)
            PROJ_NAME=$(echo "$SESSION_NAME" | sed 's/claude-team-//')
            WINDOW_COUNT=$(tmux list-windows -t "$SESSION_NAME" 2>/dev/null | wc -l | tr -d ' ')
            echo -e "  ${GREEN}●${NC} $SESSION_NAME (윈도우 ${WINDOW_COUNT}개)"
            echo "    접속: tmux attach -t $SESSION_NAME"
            echo "    종료: ./scripts/team-stop.sh $PROJ_NAME"
        done
    fi

    echo ""
    echo "특정 프로젝트 상세 보기: ./scripts/team-status.sh [프로젝트명]"
    exit 0
fi

# ============================================================
# 특정 프로젝트 상태 확인
# ============================================================
SESSION_NAME="claude-team-${PROJECT_NAME}"

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}  팀 상태: $PROJECT_NAME${NC}"
echo -e "${BLUE}=====================================${NC}"
echo -e "시간: $(date)"
echo ""

# 세션 존재 확인
if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo -e "${RED}세션 '$SESSION_NAME'이 실행 중이지 않습니다.${NC}"
    echo ""
    echo "시작 방법: ./scripts/team-start.sh [템플릿] $PROJECT_NAME"
    exit 1
fi

# ============================================================
# tmux 윈도우 상태
# ============================================================
echo -e "${CYAN}[ tmux 윈도우 ]${NC}"
tmux list-windows -t "$SESSION_NAME" -F "  #{window_index} | #{window_name} | 명령: #{pane_current_command} | 활성: #{?window_active,현재 창,}" 2>/dev/null

echo ""

# ============================================================
# workspace 결과물 확인
# ============================================================
echo -e "${CYAN}[ 작업 결과물 (workspace/) ]${NC}"

WORKSPACE_DIR="$PROJECT_DIR/workspace"
if [ -d "$WORKSPACE_DIR" ]; then
    for member_dir in "$WORKSPACE_DIR"/*/; do
        MEMBER_NAME=$(basename "$member_dir")
        if [ "$MEMBER_NAME" = "shared" ] || [ "$MEMBER_NAME" = ".gitkeep" ]; then
            continue
        fi

        FILE_COUNT=$(find "$member_dir" -type f ! -name ".gitkeep" 2>/dev/null | wc -l | tr -d ' ')
        DONE_FILE="$member_dir/DONE.md"

        if [ -f "$DONE_FILE" ]; then
            echo -e "  ${GREEN}✓${NC} $MEMBER_NAME/ (파일 ${FILE_COUNT}개) - 완료"
        elif [ "$FILE_COUNT" -gt 0 ]; then
            echo -e "  ${YELLOW}▶${NC} $MEMBER_NAME/ (파일 ${FILE_COUNT}개) - 진행 중"
        else
            echo -e "  ${NC}○${NC} $MEMBER_NAME/ - 대기 중"
        fi
    done

    # shared 디렉토리
    SHARED_FILES=$(find "$WORKSPACE_DIR/shared" -type f ! -name ".gitkeep" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "  ${CYAN}shared/ (공유 파일 ${SHARED_FILES}개)${NC}"
    if [ "$SHARED_FILES" -gt 0 ]; then
        find "$WORKSPACE_DIR/shared" -type f ! -name ".gitkeep" -exec basename {} \; 2>/dev/null | sed 's/^/    - /'
    fi
else
    echo "  workspace/ 디렉토리가 없습니다."
fi

echo ""

# ============================================================
# 최근 로그 확인
# ============================================================
echo -e "${CYAN}[ 최근 실행 로그 ]${NC}"
LOGS_DIR="$PROJECT_DIR/logs"
if [ -d "$LOGS_DIR" ]; then
    RECENT_LOG=$(ls -t "$LOGS_DIR" 2>/dev/null | head -1)
    if [ -n "$RECENT_LOG" ]; then
        echo "  최근 로그: $LOGS_DIR/$RECENT_LOG"
    else
        echo "  로그 없음 (team-run.sh 실행 시 생성)"
    fi
fi

echo ""
echo -e "${BLUE}[ 조작 명령어 ]${NC}"
echo "  세션 접속:   tmux attach -t $SESSION_NAME"
echo "  윈도우 전환: Ctrl-b + 숫자키"
echo "  세션 분리:   Ctrl-b + d"
echo "  팀 종료:     ./scripts/team-stop.sh $PROJECT_NAME"
