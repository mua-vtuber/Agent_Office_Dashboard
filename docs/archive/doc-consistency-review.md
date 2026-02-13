# Documentation Consistency Review

작성일: 2026-02-13
목적: 구버전 표현/충돌 내용을 정리하고 구현 우선순위 기준으로 문서를 정렬한다.

## 1. 정리 원칙
- 최신 기준 문서 우선순위:
  1. `event-schema.md`
  2. `state-machine.md`
  3. `system-architecture.md`
  4. `settings-spec.md`
  5. `implementation-plan.md`
- 상위 문서와 충돌하면 하위 문서를 수정한다.

## 2. 반영 완료 항목
1. `blocked` 상태를 `pending_input`/`failed`로 세분화
2. `meeting_point` 대신 고정 `meeting_spot_id` 사용
3. 다중 터미널 식별자(`workspace_id`, `terminal_session_id`, `run_id`) 표준화
4. Hooks 온보딩/설치 플로우 문서화
5. Mermaid 아키텍처 다이어그램 추가
6. Time Travel 디버깅 스펙 추가

## 3. 남은 정리 포인트
1. 예시 mock 데이터 생성 규칙 문서(`mock-data-spec.md`) 추가 여부 결정

## 4. 구현 우선순위 (실행 순서)
1. Phase 1: 이벤트 계약/수집기/API 스켈레톤 (`event-schema.md`, `system-architecture.md`)
2. Phase 2: 세션 레지스트리/스코프 필터 (`session-routing.md`)
3. Phase 3: Dashboard + Time Travel v1.1 (`product-spec.md`, `time-travel-spec.md`)
4. Phase 4: Office 상태머신 연출 (`state-machine.md`)
5. Phase 5: Settings + Hooks Onboarding (`settings-spec.md`, `hooks-onboarding.md`)
6. Phase 6: 성능/안정화 (`performance-targets.md`)

## 5. 참조
- 의견 원문: `제미니의 추가의견.md`
- 반영 추적: `gemini-feedback-tracking.md`
