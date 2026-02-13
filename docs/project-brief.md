# Agent Office Dashboard - Brief

## 목적
- Claude Code 팀 에이전트 활동을 실시간으로 수집하여,
  - Office 탭에서 캐릭터 기반으로 시각화하고,
  - Dashboard 탭에서 운영 상태를 보여주며,
  - Agents 탭에서 에이전트 소개/유형을 보여주고,
  - Settings 탭에서 규칙을 관리한다.

## 핵심 결정
- Analytics API 없이 시작한다.
- Hooks/세션 이벤트 기반 실시간 파이프라인을 사용한다.
- 서버 권위 상태 모델(서버가 현재 상태 계산)을 사용한다.
- 기본 오피스 레이아웃은 `kr_t_left_v2`(좌측 T + 중앙 팀원 + 우측 탕비실)로 시작한다.
- 기술 스택:
  - Frontend: `Vite + React + React Router + Zustand + PixiJS`
  - Backend: `Node.js + Fastify + ws + zod`
  - Storage: `SQLite 단일(better-sqlite3)`
  - Package Manager: `pnpm workspace`

## 문서 링크
- 전체 인덱스: `README.md`
- 작업 시작 세트: `working-set.md`
- 제품 요구사항: `product-spec.md`
- 시스템 구조: `system-architecture.md`
- 이벤트 계약: `event-schema.md`
- 상태 전이 규칙: `state-machine.md`
- 오피스 레이아웃: `office-layout-spec.md`
- 오피스 행동/모션: `office-behavior-spec.md`
- Agents 탭 사양: `agents-tab-spec.md`
- 설정 사양: `settings-spec.md`
- 세션 라우팅: `session-routing.md`
- Hooks 온보딩: `hooks-onboarding.md`
- Time Travel 사양: `time-travel-spec.md`
- 성능 목표: `performance-targets.md`
- 구현 계획: `implementation-plan.md`
- 미결정/리스크: `open-questions.md`

## 현재 상태 (2026-02-13)
- 프로젝트 논의 단계
- 상세 설계 문서화 완료
- 다음 단계: 기술 스택 확정 후 코드 베이스 생성
