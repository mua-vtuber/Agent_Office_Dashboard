# Hooks Quickstart (Cross-Project)

이 문서는 Agent Office Dashboard 백엔드(`http://127.0.0.1:4800`)로
Claude Code hook 이벤트를 전송하는 최소 설정이다.

## 1) 준비
- 백엔드 실행: `pnpm --filter @aod/backend dev`
- Hook 스크립트 경로 확인:
  - `<AOD_ROOT>/scripts/hooks/forward-to-aod.mjs`
  - `<AOD_ROOT>`는 이 프로젝트의 루트 디렉토리 (절대경로로 치환)

## 2) 다른 프로젝트에 Hook 설정
대상 프로젝트의 `.claude/settings.local.json`에 아래를 추가:

```json
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <AOD_ROOT>/scripts/hooks/forward-to-aod.mjs"
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <AOD_ROOT>/scripts/hooks/forward-to-aod.mjs"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <AOD_ROOT>/scripts/hooks/forward-to-aod.mjs"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <AOD_ROOT>/scripts/hooks/forward-to-aod.mjs"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <AOD_ROOT>/scripts/hooks/forward-to-aod.mjs"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <AOD_ROOT>/scripts/hooks/forward-to-aod.mjs"
          }
        ]
      }
    ]
  }
}
```

> **Tip**: 대시보드 설정 페이지에서 "Install Global Hooks" 버튼을 누르면 자동으로 설치됩니다.


## 2-1) 전역 Hook 템플릿
- 파일: `docs/global-hooks-template.json`
- 설치 대상: `~/.claude/settings.json`
- 기존 전역 설정이 있으면 `hooks` 섹션만 병합

## 3) 선택 환경변수
터미널 이름/실행 구분을 강제로 넣고 싶으면 Claude 실행 전에 설정:

- `AOD_COLLECTOR_URL` (기본: `http://127.0.0.1:4800/ingest/hooks`)
- `AOD_WORKSPACE_ID` (기본: 현재 폴더명)
- `AOD_TERMINAL_SESSION_ID` (기본: `TERM_SESSION_ID` → `WT_SESSION`(윈도우) → 현재 `tty` → payload의 `session_id`)
- `AOD_TERMINAL_LABEL` (예: `backend-wsl`, `hotfix-term`)
- `AOD_RUN_ID` (예: `run-2026-02-13-01`)
- `DASHBOARD_TOKEN` (인증 헤더 필요 시)

예시 (bash / zsh):

```bash
export AOD_TERMINAL_LABEL="wsl-main"
export AOD_RUN_ID="run-$(date +%Y%m%d-%H%M%S)"
```

예시 (PowerShell):

```powershell
$env:AOD_TERMINAL_LABEL = "win-main"
$env:AOD_RUN_ID = "run-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
```

## 4) 확인
1. Claude Code에서 도구 호출이 발생하는 작업 1회 실행
2. 대시보드에서 확인:
   - `http://127.0.0.1:3000/dashboard`
3. 백엔드 헬스 확인:
   - bash: `curl http://127.0.0.1:4800/api/health`
   - PowerShell: `Invoke-RestMethod http://127.0.0.1:4800/api/health`

## 5) 주의
- Hook은 실패해도 Claude 작업을 막지 않도록 에러를 보고한 후 종료된다.
- 같은 프로젝트에서 기존 `.claude/settings.local.json`을 이미 쓰고 있으면 수동 병합해야 한다.
- 같은 터미널에서 서브에이전트가 여러 개 떠도 기본값은 터미널 세션 기반으로 같은 `terminal_session_id`로 묶인다.
