#!/bin/bash
# ============================================================
# Claude Code Teams + tmux 스타터킷 - 비대화형 병렬 실행 스크립트
# 사용법: ./scripts/team-run.sh [템플릿명] "작업 설명" [옵션]
#
# 예시:
#   ./scripts/team-run.sh web-dev "간단한 TODO 앱 만들기"
#   ./scripts/team-run.sh code-review "src/ 디렉토리 전체 리뷰"
#   ./scripts/team-run.sh full-cycle "블로그 플랫폼 MVP 개발"
#   ./scripts/team-run.sh web-dev "로그인 기능 추가" --max-budget 2 --max-turns 15
# ============================================================

set -e

# Homebrew PATH 추가 (Apple Silicon)
export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 인자 파싱
TEMPLATE=${1:-"web-dev"}
TASK_DESC="${2:-}"
MAX_BUDGET_USD=${4:-5}    # --max-budget 다음 값
MAX_TURNS=${6:-20}        # --max-turns 다음 값

# 옵션 파싱
for i in "$@"; do
    case $i in
        --max-budget)
            MAX_BUDGET_USD="${!OPTIND}"; shift;;
        --max-turns)
            MAX_TURNS="${!OPTIND}"; shift;;
    esac
done

# getopt 스타일 파싱
while [[ $# -gt 0 ]]; do
    case "$1" in
        --max-budget) MAX_BUDGET_USD="$2"; shift 2;;
        --max-turns) MAX_TURNS="$2"; shift 2;;
        --) shift; break;;
        -*) shift;;
        *) shift;;
    esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================================
# 입력 검증
# ============================================================
if [ -z "$TASK_DESC" ]; then
    echo "사용법: $0 [템플릿명] \"작업 설명\""
    echo ""
    echo "예시:"
    echo "  $0 web-dev \"TODO 앱 만들기\""
    echo "  $0 code-review \"src/ 디렉토리 리뷰\""
    echo ""
    echo "사용 가능한 템플릿:"
    for f in "$PROJECT_DIR/templates/"*.json; do
        TNAME=$(basename "$f" .json)
        TDESC=$(jq -r '.description // "설명 없음"' "$f" 2>/dev/null)
        echo "  - $TNAME: $TDESC"
    done
    exit 1
fi

TEMPLATE_FILE="$PROJECT_DIR/templates/${TEMPLATE}.json"
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo -e "${RED}오류: 템플릿을 찾을 수 없습니다: $TEMPLATE_FILE${NC}"
    exit 1
fi

# ============================================================
# 실행 준비
# ============================================================
TEMPLATE_DISPLAY=$(jq -r '.display_name // .name' "$TEMPLATE_FILE")
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="$PROJECT_DIR/logs/${TIMESTAMP}-${TEMPLATE}"
PIDS=()

mkdir -p "$LOG_DIR"
mkdir -p "$PROJECT_DIR/workspace/shared"

# 각 팀원 workspace 생성
jq -r '.members[].name' "$TEMPLATE_FILE" | while read -r MEMBER_NAME; do
    mkdir -p "$PROJECT_DIR/workspace/$MEMBER_NAME"
done

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  비대화형 팀 실행: $TEMPLATE_DISPLAY${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "작업: ${YELLOW}$TASK_DESC${NC}"
echo -e "로그: $LOG_DIR"
echo -e "제한: 팀원당 최대 \$$MAX_BUDGET_USD / ${MAX_TURNS}턴"
echo ""

# ============================================================
# 각 팀원 병렬 실행 (비대화형 모드)
# ============================================================
echo -e "${YELLOW}팀원들 병렬 실행 시작...${NC}"

MEMBER_TOTAL=$(jq '.members | length' "$TEMPLATE_FILE")
for i in $(seq 0 $((MEMBER_TOTAL - 1))); do
    MEMBER_NAME=$(jq -r ".members[$i].name" "$TEMPLATE_FILE")
    MEMBER_DISPLAY=$(jq -r ".members[$i].display_name" "$TEMPLATE_FILE")
    MEMBER_AGENT=$(jq -r ".members[$i].agent" "$TEMPLATE_FILE")
    MEMBER_ROLE=$(jq -r ".members[$i].role" "$TEMPLATE_FILE")
    MEMBER_EXTRA=$(jq -r ".members[$i].extra_prompt // \"\"" "$TEMPLATE_FILE")

    LOG_FILE="$LOG_DIR/${MEMBER_NAME}.json"
    LOG_TEXT="$LOG_DIR/${MEMBER_NAME}.txt"

    # 시스템 프롬프트 구성
    SYSTEM_PROMPT="당신의 역할: ${MEMBER_DISPLAY} (${MEMBER_ROLE})"
    if [ -n "$MEMBER_EXTRA" ]; then
        SYSTEM_PROMPT="$SYSTEM_PROMPT

추가 지시사항:
$MEMBER_EXTRA"
    fi
    SYSTEM_PROMPT="$SYSTEM_PROMPT

작업 결과물은 workspace/${MEMBER_NAME}/ 디렉토리에 저장하세요.
공유 파일은 workspace/shared/ 에 저장하세요."

    # 팀 리더는 전체 작업 조율, 나머지는 역할별 작업
    if [ "$MEMBER_NAME" = "leader" ]; then
        MEMBER_TASK="다음 프로젝트를 팀 리더로서 관리하세요: $TASK_DESC

각 팀원의 역할을 파악하고, 전체 작업 계획을 workspace/leader/plan.md 에 작성하세요.
그런 다음 각 팀원에게 구체적인 작업 지시를 workspace/shared/leader-to-[팀원명]-instructions.md 파일로 전달하세요.
마지막으로 workspace/shared/final-report.md 에 종합 보고서를 작성하세요."
    else
        MEMBER_TASK="당신의 역할에 맞게 다음 작업을 수행하세요: $TASK_DESC

workspace/shared/ 에서 팀 리더의 지시 파일이 있다면 먼저 읽고 시작하세요.
작업이 완료되면 반드시 workspace/${MEMBER_NAME}/DONE.md 에 결과 요약을 작성하세요."
    fi

    # 백그라운드로 실행
    (
        claude -p "$MEMBER_TASK" \
            --agent "$MEMBER_AGENT" \
            --append-system-prompt "$SYSTEM_PROMPT" \
            --max-turns "$MAX_TURNS" \
            --max-budget-usd "$MAX_BUDGET_USD" \
            --output-format json \
            --allowedTools "Read,Write,Edit,Bash" \
            2>"$LOG_TEXT" | tee "$LOG_FILE" > /dev/null
        echo "$MEMBER_NAME 완료" >> "$LOG_DIR/.status"
    ) &

    PIDS+=($!)
    echo -e "  ${GREEN}▶${NC} [$((i+1))/$MEMBER_TOTAL] $MEMBER_DISPLAY 시작 (PID: $!)"
done

echo ""
echo -e "${YELLOW}모든 팀원 실행 중... 완료까지 기다리세요.${NC}"
echo "(Ctrl+C로 중단 가능)"
echo ""

# ============================================================
# 진행 상태 모니터링
# ============================================================
COMPLETED=0
TOTAL_MEMBERS=$MEMBER_TOTAL
START_TIME=$(date +%s)

while [ $COMPLETED -lt $TOTAL_MEMBERS ]; do
    sleep 5
    if [ -f "$LOG_DIR/.status" ]; then
        COMPLETED=$(wc -l < "$LOG_DIR/.status")
    fi
    ELAPSED=$(( $(date +%s) - START_TIME ))
    echo -ne "\r  진행: $COMPLETED/$TOTAL_MEMBERS 완료 | 경과: ${ELAPSED}초  "
done

# 모든 백그라운드 프로세스 완료 대기
for PID in "${PIDS[@]}"; do
    wait "$PID" 2>/dev/null || true
done

echo ""
echo ""

# ============================================================
# 결과 요약 출력
# ============================================================
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  팀 실행 완료!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "작업: $TASK_DESC"
echo -e "로그 위치: $LOG_DIR"
echo ""
echo "팀원별 결과:"

for i in $(seq 0 $((MEMBER_TOTAL - 1))); do
    MEMBER_NAME=$(jq -r ".members[$i].name" "$TEMPLATE_FILE")
    MEMBER_DISPLAY=$(jq -r ".members[$i].display_name" "$TEMPLATE_FILE")
    LOG_FILE="$LOG_DIR/${MEMBER_NAME}.json"
    DONE_FILE="$PROJECT_DIR/workspace/${MEMBER_NAME}/DONE.md"

    if [ -f "$LOG_FILE" ]; then
        # JSON에서 오류 여부 확인
        HAS_ERROR=$(jq -r '.is_error // false' "$LOG_FILE" 2>/dev/null)
        if [ "$HAS_ERROR" = "true" ]; then
            echo -e "  ${RED}✗${NC} $MEMBER_DISPLAY - 오류 발생 (로그: ${MEMBER_NAME}.json)"
        else
            echo -e "  ${GREEN}✓${NC} $MEMBER_DISPLAY - 완료"
        fi
    else
        echo -e "  ${YELLOW}?${NC} $MEMBER_DISPLAY - 결과 파일 없음"
    fi

    # DONE.md 존재 시 요약 출력
    if [ -f "$DONE_FILE" ]; then
        head -5 "$DONE_FILE" | sed 's/^/    /'
    fi
done

echo ""
echo -e "${BLUE}결과물 확인:${NC}"
echo "  workspace/ 디렉토리에서 팀원별 결과물 확인"
echo "  workspace/shared/final-report.md - 종합 보고서"
echo ""
echo "  자세한 로그: $LOG_DIR/"
