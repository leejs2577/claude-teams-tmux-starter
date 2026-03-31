#!/bin/bash
# ============================================================
# Claude Code Teams + tmux 스타터킷 - 팀 시작 스크립트
# 사용법: ./scripts/team-start.sh [템플릿명] [프로젝트명]
#
# 예시:
#   ./scripts/team-start.sh                      # 기본(web-dev) + 프로젝트명 입력 안내
#   ./scripts/team-start.sh web-dev my-app       # 웹 개발 팀, 프로젝트명 my-app
#   ./scripts/team-start.sh code-review pr-142   # 코드 리뷰 팀
#   ./scripts/team-start.sh full-cycle todo-app  # 풀사이클 팀
# ============================================================

set -e

# Homebrew PATH 추가 (Apple Silicon)
export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE=${1:-"web-dev"}
PROJECT_NAME=${2:-""}

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================================
# 프로젝트명 입력
# ============================================================
if [ -z "$PROJECT_NAME" ]; then
    echo -e "${BLUE}프로젝트 이름을 입력하세요 (영문, 하이픈 허용):${NC} "
    read -r PROJECT_NAME
    PROJECT_NAME=$(echo "$PROJECT_NAME" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')
fi

if [ -z "$PROJECT_NAME" ]; then
    PROJECT_NAME="project-$(date +%H%M%S)"
fi

SESSION_NAME="claude-team-${PROJECT_NAME}"

# ============================================================
# 의존성 확인
# ============================================================
if ! command -v tmux &>/dev/null; then
    echo -e "${RED}오류: tmux가 설치되지 않았습니다.${NC}"
    echo "설치 방법: brew install tmux"
    exit 1
fi

if ! command -v jq &>/dev/null; then
    echo -e "${RED}오류: jq가 설치되지 않았습니다.${NC}"
    echo "설치 방법: brew install jq"
    exit 1
fi

if ! command -v claude &>/dev/null; then
    echo -e "${RED}오류: claude CLI가 설치되지 않았습니다.${NC}"
    exit 1
fi

# ============================================================
# 템플릿 로드
# ============================================================
TEMPLATE_FILE="$PROJECT_DIR/templates/${TEMPLATE}.json"

if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "${RED}오류: 템플릿을 찾을 수 없습니다: $TEMPLATE_FILE${NC}"
    echo ""
    echo "사용 가능한 템플릿:"
    for f in "$PROJECT_DIR/templates/"*.json; do
        TNAME=$(basename "$f" .json)
        TDESC=$(jq -r '.description // "설명 없음"' "$f" 2>/dev/null)
        echo "  - $TNAME: $TDESC"
    done
    exit 1
fi

TEMPLATE_DISPLAY=$(jq -r '.display_name // .name' "$TEMPLATE_FILE")
MEMBER_COUNT=$(jq '.members | length' "$TEMPLATE_FILE")

# ============================================================
# 이미 존재하는 세션 확인
# ============================================================
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo -e "${YELLOW}세션 '$SESSION_NAME'이 이미 실행 중입니다.${NC}"
    echo ""
    echo "  접속하기: tmux attach -t $SESSION_NAME"
    echo "  종료하기: ./scripts/team-stop.sh $PROJECT_NAME"
    exit 0
fi

# ============================================================
# 작업 디렉토리 생성
# ============================================================
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Claude Team: $TEMPLATE_DISPLAY${NC}"
echo -e "${BLUE}  프로젝트: $PROJECT_NAME | 팀원: ${MEMBER_COUNT}명${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

mkdir -p "$PROJECT_DIR/workspace/shared"
mkdir -p "$PROJECT_DIR/logs"

# 각 팀원 workspace 디렉토리 생성
jq -r '.members[].name' "$TEMPLATE_FILE" | while read -r MEMBER_NAME; do
    mkdir -p "$PROJECT_DIR/workspace/$MEMBER_NAME"
done

# ============================================================
# tmux 세션 생성
# ============================================================
echo -e "${YELLOW}tmux 세션 생성 중...${NC}"

# 첫 번째 팀원의 정보로 첫 윈도우 생성
FIRST_MEMBER=$(jq -r '.members[0].name' "$TEMPLATE_FILE")
FIRST_DISPLAY=$(jq -r '.members[0].display_name' "$TEMPLATE_FILE")

tmux new-session -d -s "$SESSION_NAME" -n "$FIRST_MEMBER" -c "$PROJECT_DIR"

# 나머지 팀원 윈도우 생성
MEMBER_COUNT_MINUS1=$(($(jq '.members | length' "$TEMPLATE_FILE") - 1))
for i in $(seq 1 $MEMBER_COUNT_MINUS1); do
    MEMBER_NAME=$(jq -r ".members[$i].name" "$TEMPLATE_FILE")
    tmux new-window -t "$SESSION_NAME" -n "$MEMBER_NAME" -c "$PROJECT_DIR"
done

# 상태 모니터링 윈도우 추가
tmux new-window -t "$SESSION_NAME" -n "status" -c "$PROJECT_DIR"

echo -e "  ${GREEN}✓${NC} tmux 세션 '$SESSION_NAME' 생성"

# ============================================================
# 각 팀원 윈도우에서 Claude 시작
# ============================================================
echo -e "${YELLOW}각 팀원 Claude 인스턴스 시작 중...${NC}"

MEMBER_TOTAL=$(jq '.members | length' "$TEMPLATE_FILE")
for i in $(seq 0 $((MEMBER_TOTAL - 1))); do
    MEMBER_NAME=$(jq -r ".members[$i].name" "$TEMPLATE_FILE")
    MEMBER_DISPLAY=$(jq -r ".members[$i].display_name" "$TEMPLATE_FILE")
    MEMBER_AGENT=$(jq -r ".members[$i].agent" "$TEMPLATE_FILE")
    MEMBER_ROLE=$(jq -r ".members[$i].role" "$TEMPLATE_FILE")
    MEMBER_EXTRA=$(jq -r ".members[$i].extra_prompt // \"\"" "$TEMPLATE_FILE")

    # 시스템 프롬프트 조합
    SYSTEM_PROMPT="프로젝트명: ${PROJECT_NAME}\n팀 역할: ${MEMBER_DISPLAY} (${MEMBER_ROLE})"
    if [ -n "$MEMBER_EXTRA" ]; then
        SYSTEM_PROMPT="$SYSTEM_PROMPT\n\n추가 지시사항:\n$MEMBER_EXTRA"
    fi
    SYSTEM_PROMPT="$SYSTEM_PROMPT\n\n이 프로젝트의 작업 결과물은 workspace/${MEMBER_NAME}/ 디렉토리에 저장하세요."

    # tmux 윈도우에서 claude 실행
    CLAUDE_CMD="claude --agent $MEMBER_AGENT --append-system-prompt \"$(echo -e "$SYSTEM_PROMPT")\""

    tmux send-keys -t "${SESSION_NAME}:${MEMBER_NAME}" "$CLAUDE_CMD" C-m

    echo -e "  ${GREEN}✓${NC} [$((i+1))/$MEMBER_TOTAL] $MEMBER_DISPLAY ($MEMBER_AGENT)"
    sleep 0.5  # 세션 초기화 간격
done

# 상태 윈도우 설정
WATCH_CMD="echo '=== Claude Team Status ===' && echo 'Session: $SESSION_NAME' && echo \"Time: \$(date)\" && echo '' && tmux list-windows -t '$SESSION_NAME' -F '  #{window_index} | #{window_name} | #{pane_current_command}'"
tmux send-keys -t "${SESSION_NAME}:status" "watch -n 10 \"$WATCH_CMD\" 2>/dev/null || $WATCH_CMD" C-m

# ============================================================
# 워크플로우 안내 출력 (팀 리더 윈도우에서)
# ============================================================
WORKFLOW=$(jq -r '.workflow[]?' "$TEMPLATE_FILE" | head -5)
if [ -n "$WORKFLOW" ]; then
    # 워크플로우를 파일에 저장
    WORKFLOW_FILE="$PROJECT_DIR/workspace/shared/workflow.md"
    echo "# ${TEMPLATE_DISPLAY} 워크플로우" > "$WORKFLOW_FILE"
    echo "" >> "$WORKFLOW_FILE"
    echo "**프로젝트**: $PROJECT_NAME" >> "$WORKFLOW_FILE"
    echo "**시작 시간**: $(date)" >> "$WORKFLOW_FILE"
    echo "" >> "$WORKFLOW_FILE"
    echo "## 권장 진행 순서" >> "$WORKFLOW_FILE"
    jq -r '.workflow[]?' "$TEMPLATE_FILE" >> "$WORKFLOW_FILE"
fi

# ============================================================
# 완료 메시지
# ============================================================
echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  팀 시작 완료!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "팀 구성:"
jq -r '.members[] | "  - \(.display_name) [\(.name)]"' "$TEMPLATE_FILE"
echo ""
echo -e "${BLUE}tmux 기본 조작법:${NC}"
echo "  세션 접속:      tmux attach -t $SESSION_NAME"
echo "  윈도우 전환:    Ctrl-b + 숫자키 (0, 1, 2...)"
echo "  윈도우 목록:    Ctrl-b + w"
echo "  세션 분리:      Ctrl-b + d  (백그라운드 실행)"
echo "  스크롤 모드:    Ctrl-b + [  (q로 종료)"
echo ""
echo -e "${BLUE}팀 관리 명령어:${NC}"
echo "  상태 확인: ./scripts/team-status.sh $PROJECT_NAME"
echo "  팀 종료:   ./scripts/team-stop.sh $PROJECT_NAME"
echo ""

# tmux 세션에 자동 접속
echo "tmux 세션에 접속합니다... (Ctrl-b + d로 분리, 세션은 백그라운드에서 계속 실행)"
sleep 1
tmux attach -t "$SESSION_NAME"
