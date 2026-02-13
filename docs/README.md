# Agent Office Dashboard Docs

이 폴더는 `agent-office-dashboard` 프로젝트의 기준 문서 모음이다.
목표는 세션이 바뀌거나 다른 AI/개발자가 합류해도 즉시 프로젝트를 이해하고 이어서 작업할 수 있게 하는 것이다.

## 프로젝트 한 줄 정의
- Claude Code 팀 에이전트 활동을 실시간 이벤트로 수집해, 오피스 시각화 탭과 운영 대시보드 탭으로 보여주는 내부 도구.

## 문서 계층

### 1) North Star
- `project-brief.md`: 현재 목표/핵심 결정 요약
- `working-set.md`: 코딩 시작 전 필수 읽기 세트

### 2) Build Specs
- `product-spec.md`: 제품 요구사항(PRD 수준)
- `system-architecture.md`: 시스템 구조/데이터 흐름/컴포넌트
- `event-schema.md`: 이벤트 계약(schema) 정의
- `state-machine.md`: 시각화 연출 상태머신 정의
- `implementation-plan.md`: 구현 단계와 체크리스트

### 3) Feature Specs
- `office-layout-spec.md`: 오피스 좌석/구역 레이아웃 사양
- `office-behavior-spec.md`: 상태별 모션/이펙트/완료 후 행동 사양
- `agents-tab-spec.md`: Agents 탭 UI/라벨 규칙 사양
- `settings-spec.md`: 설정 항목/권한/유효성 규칙
- `session-routing.md`: 다중 터미널 추적/대시보드 라우팅
- `hooks-onboarding.md`: Hooks 설정 안내/점검/설치 플로우
- `time-travel-spec.md`: 실패 이벤트 문맥 재구성(Time Travel) 스펙
- `performance-targets.md`: 성능 목표/측정 기준/SLO
- `operations-first-ux-checklist.md`: 운영 우선 UX 점검표(정보/생산성/신뢰성)
- `open-questions.md`: 미결정/리스크/결정 기준

## 현재 가정 (2026-02-13 기준)
- Claude Code Analytics API를 사용할 수 없는 환경을 기본 전제로 한다.
- 실시간성은 Hooks + 세션 이벤트 스트리밍(WebSocket)으로 확보한다.
- i18n 기반 설계를 기본으로 하며 초기 언어는 `ko`, `en`을 지원한다.
- 기술스택 확정:
  - Frontend: `Vite + React + React Router + Zustand + PixiJS`
  - Backend: `Node.js + Fastify + ws + zod`
  - Storage: `SQLite 단일(better-sqlite3)`
  - Package Manager: `pnpm workspace`

## 범위
- 포함:
  - Office 탭: 캐릭터 이동/대화/복귀 연출
  - Dashboard 탭: 현재 상태 + 이벤트 로그
  - Agents 탭: 전체 에이전트 목록/소개/라벨(`정직원`/`계약직`)
  - Settings 탭: 에이전트/좌석/연출/언어/연결 설정
  - 수집기: 이벤트 정규화/저장/브로드캐스트
- 제외 (MVP):
  - 고급 조직 분석 리포팅(월간 비용/팀 비교 등)
  - 외부 SaaS 멀티테넌트 운영 기능

## 읽는 순서 (신규 합류자용)
1. `project-brief.md`
2. `working-set.md`
3. `product-spec.md`
4. `system-architecture.md`
5. `event-schema.md`
6. `state-machine.md`
7. `implementation-plan.md`

## 아카이브
- `archive/제미니의 추가의견.md`
- `archive/gemini-feedback-tracking.md`
- `archive/doc-consistency-review.md`

## 용어
- Manager Agent: 지시를 내리는 팀장 역할 에이전트
- Worker Agent: 지시를 수행하는 팀원 역할 에이전트
- Event Collector: Hooks/스트림 이벤트를 수집하는 백엔드 컴포넌트
- Office Renderer: 시각화 탭의 2D 렌더링 엔진(Canvas/Pixi)

## 변경 원칙
- 이벤트 스키마 변경 시 반드시 `event-schema.md`를 먼저 갱신한다.
- 상태 전이 변경 시 반드시 `state-machine.md`를 같이 갱신한다.
- 설정 항목 변경 시 반드시 `settings-spec.md`를 같이 갱신한다.
- 라우팅/스코프 변경 시 반드시 `session-routing.md`를 같이 갱신한다.
