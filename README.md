# Claude Code Teams + tmux 에이전트 시스템 스타터킷

Claude Code의 Teams 기능과 tmux를 결합하여, 여러 AI 에이전트가 병렬로 협업하는 시스템입니다.
어떤 프로젝트든 팀원들이 역할을 나눠 동시에 기획, 개발, 리뷰, 테스트를 진행할 수 있습니다.

---

## 빠른 시작 (3단계)

### 1단계: 환경 설정

```bash
./scripts/setup.sh
```

tmux, jq, claude CLI 설치 여부를 확인하고 필요한 디렉토리를 생성합니다.
tmux가 없다면 먼저 설치하세요: `brew install tmux`

### 2단계: 팀 시작

```bash
# 대화형 모드 (tmux 세션에서 팀원과 직접 소통)
./scripts/team-start.sh web-dev my-project

# 또는 비대화형 모드 (자동으로 실행 후 결과 수집)
./scripts/team-run.sh web-dev "TODO 앱 만들기"
```

### 3단계: 결과 확인

```bash
# 팀 상태 확인 (대화형 모드)
./scripts/team-status.sh my-project

# 결과물 확인
ls workspace/
cat workspace/shared/final-report.md
```

---

## 핵심 개념

### Claude Code Teams란?

Claude Code의 실험적 기능으로, 여러 Claude 인스턴스가 팀을 이루어 작업합니다.

- **팀 리더**: 전체 작업을 조율하고 팀원에게 배분
- **팀원**: 각자의 역할(기획/개발/리뷰/QA)에 집중하여 독립적으로 작업
- **병렬 처리**: 의존성이 없는 작업은 동시에 실행되어 시간 단축

### tmux란?

터미널 멀티플렉서(Terminal Multiplexer). 하나의 터미널에서 여러 창을 동시에 실행하고 관리합니다.

```
터미널 화면
├── 윈도우 0: leader (팀 리더 Claude)
├── 윈도우 1: frontend (프론트엔드 개발자 Claude)
├── 윈도우 2: backend (백엔드 개발자 Claude)
├── 윈도우 3: qa (QA 엔지니어 Claude)
└── 윈도우 4: status (상태 모니터링)
```

### 왜 함께 쓰나요?

| 단독 사용 | Teams + tmux |
|---------|-------------|
| 하나의 Claude가 순차적으로 작업 | 여러 Claude가 병렬로 작업 |
| 긴 작업은 시간이 오래 걸림 | 역할 분담으로 빠른 처리 |
| 단일 관점의 결과 | 다양한 관점의 심층 분석 |
| 컨텍스트 윈도우 한계 | 팀원별 독립 컨텍스트 윈도우 |

---

## 사용 가능한 템플릿

### `web-dev` - 웹 개발 팀

```bash
./scripts/team-start.sh web-dev my-webapp
```

| 팀원 | 역할 |
|------|------|
| 팀 리더 | 전체 조율, 작업 분배, 결과 통합 |
| 프론트엔드 개발자 | UI/UX 구현, 컴포넌트, 스타일링 |
| 백엔드 개발자 | API 설계/구현, 데이터베이스 |
| QA 엔지니어 | 테스트 케이스, 버그 발견 |

**적합한 경우**: 웹 앱 신규 개발, 기능 추가

---

### `code-review` - 코드 리뷰 팀

```bash
./scripts/team-start.sh code-review pr-review
```

| 팀원 | 역할 |
|------|------|
| 리뷰 총괄 | 결과 수집, 우선순위 정리 |
| 보안 리뷰어 | OWASP Top 10 기준 보안 감사 |
| 성능 리뷰어 | 병목 분석, 최적화 제안 |
| 품질 리뷰어 | 코드 스타일, 설계 패턴, DRY 원칙 |

**적합한 경우**: PR 리뷰, 레거시 코드 감사, 보안 점검

---

### `full-cycle` - 풀사이클 팀

```bash
./scripts/team-start.sh full-cycle new-product
```

| 팀원 | 역할 |
|------|------|
| 프로젝트 매니저 | 전체 관리, 일정, 의사결정 |
| 기획자 | 요구사항 분석, PRD 작성 |
| 시스템 설계자 | 아키텍처, DB 설계, API 설계 |
| 구현 개발자 | 코드 구현, 기능 개발 |
| QA 엔지니어 | 테스트 계획, 버그 추적 |

**적합한 경우**: 아이디어 → 완성 제품, MVP 개발

---

### `custom-example` - 나만의 팀 만들기

```bash
cp templates/custom-example.json templates/my-team.json
# templates/my-team.json 편집
./scripts/team-start.sh my-team my-project
```

---

## 사용 시나리오

### 시나리오 A: "웹앱 하나 만들어달라고 하기"

```bash
# 1. 웹 개발 팀 시작
./scripts/team-start.sh web-dev todo-app

# 2. tmux 세션에 자동 접속됨
# 3. 팀 리더 윈도우(leader)에서 요청
#    "간단한 TODO 앱을 만들어주세요.
#     기능: 할 일 추가/완료 체크/삭제
#     기술: HTML/CSS/JavaScript (프론트), Node.js (백엔드)"

# 4. 팀 리더가 작업을 분배하고 팀원들이 병렬로 작업 시작
# 5. Ctrl-b + 1 (frontend 윈도우) 으로 전환하여 진행 상황 확인
# 6. Ctrl-b + 2 (backend 윈도우) 으로 전환하여 진행 상황 확인
```

### 시나리오 B: "기존 코드 리뷰 받기"

```bash
# 1. 코드 리뷰 팀으로 비대화형 실행
./scripts/team-run.sh code-review "src/ 디렉토리의 모든 파일을 리뷰해주세요. 특히 인증 관련 코드를 꼼꼼히 봐주세요."

# 2. 자동으로 세 리뷰어가 병렬로 코드 분석
# 3. 완료 후 workspace/reviewer/ 에서 결과 확인
cat workspace/reviewer/security-review.md
cat workspace/reviewer/performance-review.md
cat workspace/shared/final-report.md
```

### 시나리오 C: "아이디어를 기획부터 개발까지"

```bash
# 1. 풀사이클 팀 시작
./scripts/team-start.sh full-cycle my-startup

# 2. PM 윈도우에서 요청
#    "독서 기록 앱을 만들고 싶어요.
#     읽은 책을 기록하고, 독서 진행률을 추적하는 기능이 필요합니다.
#     모바일에서도 잘 동작해야 하고, 소셜 기능도 있으면 좋겠어요."

# 3. 팀원들이 순차/병렬로 작업:
#    - 기획자: PRD 작성
#    - 설계자: 시스템 아키텍처
#    - 개발자: 코드 구현 (기획/설계 완료 후)
#    - QA: 테스트 케이스 작성
```

---

## tmux 필수 조작법

### 기본 단축키

모든 tmux 명령은 **프리픽스 키** `Ctrl-b` 를 먼저 누르고 실행합니다.

| 단축키 | 기능 |
|--------|------|
| `Ctrl-b + 숫자` | 해당 번호 윈도우로 전환 (0, 1, 2...) |
| `Ctrl-b + n` | 다음 윈도우로 전환 |
| `Ctrl-b + p` | 이전 윈도우로 전환 |
| `Ctrl-b + w` | 윈도우 목록 보기 (방향키로 선택) |
| `Ctrl-b + d` | 세션 분리 (백그라운드에서 계속 실행) |
| `Ctrl-b + [` | 스크롤 모드 진입 (방향키/PgUp/PgDn, `q`로 종료) |
| `Ctrl-b + ?` | 전체 단축키 목록 |

### 터미널에서 사용하는 명령어

```bash
# 세션 목록 확인
tmux list-sessions

# 세션 접속
tmux attach -t claude-team-my-project

# 특정 윈도우로 접속
tmux attach -t claude-team-my-project:leader

# 세션 종료 (모든 윈도우 포함)
tmux kill-session -t claude-team-my-project
```

---

## 커스터마이징

### 새 에이전트 역할 추가

```bash
# 1. 에이전트 파일 생성
cat > .claude/agents/data-analyst.md << 'EOF'
---
name: data-analyst
description: 데이터 분석 전문 에이전트
---

# 데이터 분석가 에이전트

당신은 데이터 분석 전문가입니다.
...
EOF
```

### 새 템플릿 만들기

```bash
# 1. 기존 템플릿 복사
cp templates/custom-example.json templates/data-team.json

# 2. 편집
nano templates/data-team.json  # 또는 선호하는 에디터

# 3. 사용
./scripts/team-start.sh data-team my-analysis
```

### 팀원별 비용/턴 제한 조정

`scripts/team-run.sh` 실행 시 옵션 추가:

```bash
# 팀원당 최대 $2, 10턴으로 제한
./scripts/team-run.sh web-dev "간단한 API 만들기" --max-budget 2 --max-turns 10
```

---

## 팀 관리 명령어 정리

```bash
# 환경 설정 (처음 한 번)
./scripts/setup.sh

# 대화형 팀 시작
./scripts/team-start.sh [템플릿] [프로젝트명]

# 비대화형 병렬 실행 (자동화)
./scripts/team-run.sh [템플릿] "작업 설명"

# 팀 상태 확인
./scripts/team-status.sh [프로젝트명]   # 특정 프로젝트
./scripts/team-status.sh               # 전체 세션 목록

# 팀 종료
./scripts/team-stop.sh [프로젝트명]          # 확인 후 종료
./scripts/team-stop.sh [프로젝트명] --force  # 즉시 종료
./scripts/team-stop.sh --all                # 모든 팀 종료
```

---

## 디렉토리 구조

```
teams_tmux/
├── CLAUDE.md                 # 팀 전체 공유 컨텍스트 (Claude가 자동 로드)
├── README.md                 # 이 파일
├── .claude/
│   ├── settings.json         # Teams 활성화 + 권한 설정
│   └── agents/               # 에이전트 역할 정의
│       ├── team-leader.md
│       ├── planner.md
│       ├── developer.md
│       ├── reviewer.md
│       └── qa.md
├── scripts/
│   ├── setup.sh              # 초기 환경 설정
│   ├── team-start.sh         # 대화형 팀 시작
│   ├── team-run.sh           # 비대화형 병렬 실행
│   ├── team-status.sh        # 상태 확인
│   └── team-stop.sh          # 팀 종료
├── templates/
│   ├── web-dev.json          # 웹 개발 팀 구성
│   ├── code-review.json      # 코드 리뷰 팀 구성
│   ├── full-cycle.json       # 풀사이클 팀 구성
│   └── custom-example.json   # 커스텀 템플릿 예시
├── workspace/                # 팀원 작업 결과물
│   ├── leader/
│   ├── planner/
│   ├── developer/
│   ├── reviewer/
│   ├── qa/
│   └── shared/               # 팀원 간 공유 파일
└── logs/                     # 비대화형 실행 로그
```

---

## 트러블슈팅

### tmux 세션이 연결 안 될 때

```bash
# 세션 목록 확인
tmux list-sessions

# 특정 세션 강제 종료 후 재시작
tmux kill-session -t claude-team-my-project
./scripts/team-start.sh web-dev my-project
```

### Claude 인스턴스가 응답 없을 때

```bash
# 해당 윈도우로 전환
tmux attach -t claude-team-my-project
# Ctrl-b + 1 (문제 있는 팀원 윈도우로)
# Ctrl-C 후 다시 시작
```

### 팀원이 같은 파일을 수정하려 할 때

각 팀원이 `workspace/[팀원명]/` 하위에서만 작업하도록 CLAUDE.md에 규칙이 설정되어 있습니다.
공유 파일은 `workspace/shared/` 를 사용하세요.

### 비용이 너무 많이 나올 때

`--max-budget-usd` 와 `--max-turns` 로 제한을 낮추세요:

```bash
./scripts/team-run.sh web-dev "간단한 작업" --max-budget 1 --max-turns 10
```

### Agent Teams 기능이 활성화 안 될 때

```bash
# 환경변수 확인
echo $CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS

# 수동 활성화
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
claude  # 다시 시작
```

`.claude/settings.json` 에 이미 설정되어 있으므로 claude 실행 시 자동으로 적용됩니다.

---

## 라이선스

MIT License - 자유롭게 사용, 수정, 배포하세요.
