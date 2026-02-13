# Global Setup Checklist (Hooks + Skills)

목적: Claude에게 전역 환경 구성을 맡길 때, 누락 없이 동일한 방식으로 적용하기 위한 기준 문서.

## 1) 범위
- 대상: 전역 설정(`~/.claude/settings.json`)
- 목표:
  - Hooks: 모든 프로젝트에서 AOD 수집기로 이벤트 전송
  - Skills: 전역 스킬 경로/설치 상태 점검 및 필요한 스킬 준비

## 2) Hooks 전역 설치 기준
- 템플릿 원본: `docs/global-hooks-template.json`
- hook command:
  - `bash /home/taniar/git/agent-office-dashboard/scripts/hooks/forward-to-aod.sh`
- 이벤트 세트:
  - `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`

적용 원칙:
- 기존 `~/.claude/settings.json`의 다른 키는 유지
- `hooks` 섹션만 병합(merge)
- 동일 command가 이미 있으면 중복 추가 금지

## 3) Skills 전역 점검 기준
아래는 "점검 항목"이며, 실제 경로는 Claude가 환경에서 확인 후 적용.

점검 항목:
- 전역 skills 루트 존재 여부
- 필요한 스킬 설치 여부(부족 시 설치)
- 설정 파일에서 skills 참조가 끊기지 않았는지

현재 작업 환경에서 확인된 참고 경로(코덱스 측):
- `/home/taniar/.codex/skills`

주의:
- Claude 환경에서 경로 규칙이 다를 수 있으므로, Claude가 실제 경로를 먼저 탐지해야 함

## 4) 적용 후 검증
Hooks 검증:
1. 백엔드 실행: `pnpm --filter @aod/backend dev`
2. Claude에서 도구 호출 1회 실행
3. 대시보드 확인: `http://127.0.0.1:3000/dashboard`
4. 헬스 확인: `curl http://127.0.0.1:4800/api/health`

터미널 구분 검증:
- 같은 터미널에서 서브에이전트가 생겨도 terminal 목록이 불필요하게 늘지 않는지 확인

Skills 검증:
- Claude에서 스킬 호출/인식 가능한지 확인
- 누락 스킬이 있으면 설치 로그와 함께 재검증

## 5) Claude에게 전달할 요청 템플릿
다음 요청을 그대로 전달:

```text
다음 문서를 기준으로 전역 설정을 반영해줘:
- docs/global-setup-checklist.md
- docs/global-hooks-template.json

요구사항:
1) ~/.claude/settings.json에 hooks를 병합해줘. 기존 설정은 유지하고 hooks만 merge.
2) hook command는 반드시 아래 경로를 사용:
   bash /home/taniar/git/agent-office-dashboard/scripts/hooks/forward-to-aod.sh
3) skills 전역 경로를 먼저 탐지하고, 설치/참조 상태를 점검해줘.
4) 변경 후 검증 결과를 항목별로 보고해줘.
```

## 6) 실패 시 복구 원칙
- 전역 설정 수정 전 백업 파일 생성
- 파싱 오류 발생 시 즉시 원복
- 원복 후 diff와 오류 원인을 함께 보고
