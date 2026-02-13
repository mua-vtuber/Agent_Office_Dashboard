# Hooks Onboarding Guide

## 1. 목적
Hooks가 설정되어 있지 않으면 자동 이벤트 수집이 동작하지 않는다.
이 문서는 운영자가 Hooks 설정 상태를 점검하고, 빠르게 활성화하도록 돕는다.

## 2. 원칙
- 기본: Hooks 활성화가 "정상 모드"
- 미설정: Dashboard는 제한 모드로 동작(실시간 정확도 저하)
- 목표: 사용자가 명령 한 번 또는 UI 버튼 한 번으로 설정 완료

## 3. 사용자 플로우
1. 대시보드 접속 `/dashboard`
2. 서버가 `GET /api/integration/status` 호출
3. `hooks_configured=false`면 상단 배너 표시
4. 사용자는 아래 중 하나 선택
   - A. "설정 가이드 보기"
   - B. "자동 설정 시도" (지원 환경일 때)
5. 성공 시 상태가 `hooks_configured=true`로 전환

## 4. 상태 API 스펙 (초안)

### 4.1 GET /api/integration/status
```json
{
  "hooks_configured": false,
  "last_checked_at": "2026-02-13T15:20:00Z",
  "collector_reachable": true,
  "last_hook_event_at": null,
  "mode": "degraded"
}
```

### 4.2 POST /api/integration/hooks/install
- 목적: 가능한 경우 Hooks 템플릿을 로컬에 생성/업데이트
- 응답 예시:
```json
{
  "ok": true,
  "message": "Hooks configuration installed",
  "next_step": "Restart Claude Code session"
}
```

## 5. UI 요구사항
- 배너 문구(i18n 키 기반)
  - `integration.hooks_missing.title`
  - `integration.hooks_missing.description`
  - `integration.hooks_missing.cta_guide`
  - `integration.hooks_missing.cta_install`
- 설치 버튼 클릭 시 결과 토스트
- 실패 시 디버그 정보(권한/경로) 최소 표시

## 6. 설치 모드
- Manual 모드(필수):
  - 가이드 텍스트 + 예시 설정 파일
- Assisted 모드(선택):
  - 서버가 템플릿 파일 생성/갱신
- Validate 모드(필수):
  - 테스트 이벤트(`heartbeat`)를 보내 정상 수집 확인

## 6.1 Hook command 템플릿 가이드
- 권장 원칙:
  - Hook command는 짧게 실행되어야 하므로 네트워크 타임아웃을 짧게 둔다.
  - 전송 실패가 Claude Code 실행을 막지 않도록 실패를 무시한다.
- 예시:
```bash
curl -s -m 2 -X POST http://localhost:4800/ingest/hooks \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer $DASHBOARD_TOKEN' \
  -d "$(cat)" || true
```
- 원본 payload 구조와 normalize 규칙은 `event-schema.md`의 `5.1`, `5.2`를 따른다.

## 7. 진단 체크리스트
- collector URL 접근 가능 여부
- 인증 토큰 유효 여부
- 마지막 60초 내 hook 이벤트 수신 여부
- session 식별자(`workspace_id`, `terminal_session_id`) 포함 여부

## 8. 실패 처리
- 설치 실패해도 시스템은 동작하되 `degraded` 모드 유지
- `degraded` 모드에서는 아래 제약 명시
  - 실시간 상태 정확도 낮음
  - 세션 자동 감지 불완전

## 9. 보안
- 자동 설치는 관리자 권한 사용자만 가능
- 토큰 원문은 UI에 노출 금지
- 설치 로그에서 민감정보 마스킹

## 10. 완료 기준
- 신규 사용자가 5분 내 Hooks 설정 완료 가능
- 설정 후 30초 내 첫 `heartbeat` 이벤트 수신
