#!/bin/bash
# ============================================================
# Claude Code Teams + tmux 스타터킷 - 팀 세션 종료 스크립트
# 사용법: ./scripts/team-stop.sh [프로젝트명] [옵션]
#
# 예시:
#   ./scripts/team-stop.sh my-app          # 확인 후 종료
#   ./scripts/team-stop.sh my-app --force  # 확인 없이 강제 종료
#   ./scripts/team-stop.sh --all           # 모든 claude-team 세션 종료
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_NAME="${1:-}"
FORCE=0

# 옵션 파싱
for arg in "$@"; do
    case "$arg" in
        --force|-f) FORCE=1;;
        --all) PROJECT_NAME="--all";;
    esac
done

# tmux 확인
if ! command -v tmux &>/dev/null; then
    echo -e "${RED}tmux가 설치되지 않았습니다.${NC}"
    exit 1
fi

# ============================================================
# 모든 팀 세션 종료
# ============================================================
if [ "$PROJECT_NAME" = "--all" ]; then
    SESSIONS=$(tmux list-sessions 2>/dev/null | grep "^claude-team-" | cut -d':' -f1 || echo "")

    if [ -z "$SESSIONS" ]; then
        echo "실행 중인 팀 세션이 없습니다."
        exit 0
    fi

    echo "종료할 세션:"
    echo "$SESSIONS" | sed 's/^/  - /'

    if [ $FORCE -eq 0 ]; then
        echo ""
        read -r -p "모든 팀 세션을 종료하시겠습니까? (y/N): " CONFIRM
        if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
            echo "취소되었습니다."
            exit 0
        fi
    fi

    echo "$SESSIONS" | while IFS= read -r SESSION; do
        tmux kill-session -t "$SESSION" 2>/dev/null && echo -e "  ${GREEN}✓${NC} $SESSION 종료" || echo -e "  ${RED}✗${NC} $SESSION 종료 실패"
    done
    exit 0
fi

# ============================================================
# 특정 프로젝트 세션 종료
# ============================================================
if [ -z "$PROJECT_NAME" ]; then
    echo "사용법: $0 [프로젝트명]"
    echo ""
    echo "실행 중인 세션:"
    tmux list-sessions 2>/dev/null | grep "claude-team-" | cut -d':' -f1 | sed 's/^/  - /' || echo "  없음"
    exit 1
fi

SESSION_NAME="claude-team-${PROJECT_NAME}"

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo -e "${YELLOW}세션 '$SESSION_NAME'이 실행 중이지 않습니다.${NC}"
    exit 0
fi

# ============================================================
# 종료 확인
# ============================================================
if [ $FORCE -eq 0 ]; then
    echo -e "${YELLOW}세션 '$SESSION_NAME'을 종료합니다.${NC}"
    echo ""
    echo "현재 실행 중인 윈도우:"
    tmux list-windows -t "$SESSION_NAME" -F "  #{window_index} | #{window_name}" 2>/dev/null

    echo ""
    echo -e "${YELLOW}주의: 저장되지 않은 작업 내용이 있을 수 있습니다.${NC}"
    read -r -p "종료하시겠습니까? (y/N): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "취소되었습니다."
        exit 0
    fi
fi

# ============================================================
# 세션 종료
# ============================================================
echo -e "${YELLOW}팀 세션 종료 중...${NC}"

# 각 윈도우에 Ctrl-C 전송하여 Claude 종료 시도
WINDOWS=$(tmux list-windows -t "$SESSION_NAME" -F "#{window_index}" 2>/dev/null)
for WINDOW in $WINDOWS; do
    tmux send-keys -t "${SESSION_NAME}:${WINDOW}" "" C-m 2>/dev/null || true  # /exit 명령
    sleep 0.2
    tmux send-keys -t "${SESSION_NAME}:${WINDOW}" C-c 2>/dev/null || true
done

sleep 1

# 세션 강제 종료
tmux kill-session -t "$SESSION_NAME" 2>/dev/null

echo -e "  ${GREEN}✓${NC} 세션 '$SESSION_NAME' 종료 완료"
echo ""
echo "작업 결과물은 workspace/ 에 남아있습니다:"
ls -la "$PROJECT_DIR/workspace/" 2>/dev/null | grep -v "^total" | grep -v "^\." | head -10 || true
