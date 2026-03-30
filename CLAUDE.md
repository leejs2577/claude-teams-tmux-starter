# Claude Code Teams + tmux 스타터킷

## 프로젝트 개요

이 프로젝트는 Claude Code의 Teams 기능과 tmux를 결합한 멀티 에이전트 협업 시스템입니다.
여러 Claude 인스턴스가 각자의 역할(팀 리더, 기획자, 개발자, 리뷰어, QA)을 맡아 병렬로 작업을 수행합니다.

## 언어 및 커뮤니케이션 규칙

- **기본 응답 언어**: 한국어
- **코드 주석**: 한국어로 작성
- **커밋 메시지**: 한국어로 작성
- **문서화**: 한국어로 작성
- **변수명/함수명**: 영어 (코드 표준 준수)

## 팀 구성 및 역할

| 역할 | 에이전트 파일 | 담당 업무 |
|------|-------------|---------|
| 팀 리더 | `.claude/agents/team-leader.md` | 전체 조율, 작업 분배, 결과 통합 |
| 기획자 | `.claude/agents/planner.md` | 요구사항 분석, 기능 정의, 설계 |
| 개발자 | `.claude/agents/developer.md` | 코드 구현, 기능 개발 |
| 리뷰어 | `.claude/agents/reviewer.md` | 코드 리뷰, 품질 검사 |
| QA | `.claude/agents/qa.md` | 테스트, 버그 발견, 품질 보증 |

## 팀 워크플로우

```
사용자 요청
    ↓
팀 리더 (작업 분석 및 분해)
    ↓
팀원들에게 병렬 배분
    ├── 기획자: 요구사항 문서 작성
    ├── 개발자: 코드 구현
    └── QA: 테스트 케이스 준비
    ↓
팀 리더 (결과 통합 및 품질 확인)
    ↓
사용자에게 최종 결과 전달
```

## 파일 저장 규칙

각 팀원은 **자신의 workspace 하위 디렉토리에서만** 파일을 생성/수정합니다:

```
workspace/
├── leader/       # 팀 리더 산출물 (통합 보고서 등)
├── planner/      # 기획자 산출물 (PRD, 기능 명세서 등)
├── developer/    # 개발자 산출물 (코드, 설정 파일 등)
├── reviewer/     # 리뷰어 산출물 (리뷰 코멘트 등)
├── qa/           # QA 산출물 (테스트 케이스, 버그 리포트 등)
└── shared/       # 팀원 간 공유 파일 (다른 팀원이 읽어야 할 자료)
```

## 에이전트 간 통신 규칙

1. **파일 기반 통신**: `workspace/shared/` 에 마크다운으로 전달
2. **명확한 파일명**: `[발신자]-to-[수신자]-[내용].md` 형식 사용 (예: `planner-to-developer-api-spec.md`)
3. **작업 완료 시**: `workspace/[팀원명]/DONE.md` 에 결과 요약 기록
4. **도움 요청 시**: `workspace/shared/help-[팀원명]-[내용].md` 파일 생성

## 빠른 시작 명령어

```bash
# 환경 설정 (처음 한 번)
./scripts/setup.sh

# 대화형 팀 시작 (tmux 세션)
./scripts/team-start.sh web-dev my-project

# 비대화형 병렬 실행 (자동화)
./scripts/team-run.sh web-dev "TODO 앱 만들기"

# 팀 상태 확인
./scripts/team-status.sh my-project

# 팀 종료
./scripts/team-stop.sh my-project
```

## 주의사항

- 팀원들은 서로 다른 파일을 담당하세요. 동시에 같은 파일을 수정하면 충돌이 발생합니다.
- 팀 리더를 통해 팀을 정리하세요. 개별 팀원이 직접 정리하면 리소스가 불일치할 수 있습니다.
- 각 팀원의 비용은 독립적으로 계산됩니다. 팀 크기는 3~5명이 최적입니다.
