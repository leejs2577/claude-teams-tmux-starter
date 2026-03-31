#!/bin/bash
# ============================================================
# Claude Code Teams 모니터링 대시보드 실행 스크립트
# 사용법: ./scripts/dashboard.sh
# ============================================================

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DASHBOARD_DIR="$PROJECT_DIR/dashboard"

# dashboard 디렉토리 존재 확인
if [ ! -d "$DASHBOARD_DIR" ]; then
  echo "오류: dashboard 디렉토리가 없습니다: $DASHBOARD_DIR"
  exit 1
fi

cd "$DASHBOARD_DIR"

# npm 의존성 설치 (node_modules 없을 때만)
if [ ! -d "node_modules" ]; then
  echo "의존성 설치 중..."
  npm install --silent 2>/dev/null
fi

echo "대시보드 시작 중... http://localhost:${PORT:-4000}"
sleep 1

# 브라우저 자동 열기 (macOS)
open "http://localhost:${PORT:-4000}" 2>/dev/null || true

node server.js
