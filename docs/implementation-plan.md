# Implementation Plan

## 1. 개발 원칙
- 작은 단위로 빠르게 동작 검증
- 스키마 우선(Event-first)
- 시각화와 운영 데이터의 단일 진실원(서버 상태)

## 2. 단계별 계획

### Phase 0: 프로젝트 골격
- 목표:
  - pnpm workspace 모노레포 구조 생성
  - backend/frontend 앱 생성
- 산출물:
  - 폴더 구조
  - 실행 스크립트
- 완료 기준:
  - 로컬에서 서버/프론트 동시 실행 가능

### Phase 1: 이벤트 수집기 MVP
- 목표:
  - `/ingest/hooks` 구현
  - 이벤트 정규화 + 검증 + 저장
  - `/api/snapshot` 제공
- 산출물:
  - zod 스키마
  - SQLite 스키마(`events`, `state_current`, `agents`, `tasks`, `sessions`)
  - 상태 계산 스토어
- 완료 기준:
  - mock 이벤트 입력 시 snapshot 반영

### Phase 2: 실시간 브로드캐스트
- 목표:
  - WebSocket 서버 구현
  - event/state_update push
- 완료 기준:
  - 클라이언트에서 실시간 상태 수신

### Phase 3: Dashboard 탭
- 목표:
  - 상태 카드
  - 활성 작업 리스트
  - 이벤트 타임라인
- 완료 기준:
  - 3가지 위젯 실시간 갱신

### Phase 3.2: Agents 탭
- 목표:
  - 에이전트 목록/상세 패널 구현
  - `정직원`/`계약직` 라벨 표기
  - Office 하이라이트 연동
- 완료 기준:
  - 필터(라벨/역할/상태) 동작
  - 클릭한 에이전트가 Office에서 포커스됨

### Phase 3.5: Time Travel (v1.1)
- 목표:
  - pivot 이벤트 기준 before/after 문맥 조회
  - 특정 시점 상태 snapshot 카드
- 완료 기준:
  - 실패 이벤트 클릭 시 전후 문맥 + 상태 카드 표시

### Phase 4: Office 탭
- 목표:
  - 캐릭터 배치 렌더
  - `kr_t_left_v2` 좌석 프로필 구현(좌측 T + 중앙 팀원 + 우측 탕비실)
  - 입구-탕비실 연결 동선(`pantry_door_lane`) 반영
  - 이동/미팅/복귀 애니메이션
  - 말풍선 요약
- 완료 기준:
  - manager_assign 시나리오 연출 재현
  - manager가 좌측 T 구역에서 출발해 worker와 meeting lane에서 만나는 동선 재현
  - 비작업 에이전트의 탕비실 체류/순찰/수면 정책 동작 재현

### Phase 5: Settings 탭
- 목표:
  - 에이전트/좌석 편집
  - 전이 규칙 일부 설정화
- 완료 기준:
  - 설정 저장 후 즉시 반영

### Phase 6: 안정화/성능
- 목표:
  - 성능 SLO 측정
  - 병목 최적화
- 완료 기준:
  - `performance-targets.md`의 MVP 기준 달성

## 3. 권장 폴더 구조 (초안)
```text
agent-office-dashboard/
  apps/
    backend/
    frontend/
  packages/
    shared-schema/
  docs/
```

## 4. 체크리스트
- 공통
  - [x] 이벤트 스키마 버전 고정
  - [x] mock 이벤트 생성기 작성
  - [ ] 에러 로깅 규칙 반영
  - [x] i18n 메시지 키/번역 파일 구성(ko/en)
- 백엔드
  - [x] ingest API
  - [x] snapshot API
  - [ ] sessions API(workspace/session/run)
  - [x] agents API(`/api/agents`, `/api/agents/:agent_id`)
  - [ ] integration status API (`/api/integration/status`)
  - [ ] hooks install API (`/api/integration/hooks/install`)
  - [x] ws broadcast
  - [x] SQLite schema + repository + indexes
- 프론트엔드
  - [x] 탭 레이아웃
  - [x] dashboard 위젯
  - [x] agents 목록/상세/필터 UI
  - [x] 정직원/계약직 라벨 UI
  - [ ] 스코프 바(workspace/session/run)
  - [ ] Time Travel 패널(before/after + pivot 하이라이트)
  - [ ] hooks 미설정 배너 + 설치/가이드 진입 버튼
  - [x] office renderer
  - [x] `kr_t_left_v2` 레이아웃 프리셋 적용
  - [x] working paper / failed scream / resting zzz 이펙트 적용
  - [ ] settings 폼

## 5. 테스트 계획
- 단위 테스트
  - normalize 함수
  - reduce(state machine) 함수
- 통합 테스트
  - ingest -> ws -> UI 반영 흐름
- 수동 시나리오
  - 지시/대화/복귀
  - 실패/복구

### 5.1 Mock 이벤트 생성기 요구사항
- 위치:
  - `apps/backend/scripts/seed-mock.ts`
- 실행:
  - `pnpm --filter backend seed:mock` (또는 동등한 스크립트)
- 시나리오:
  1. 기본 작업: `agent_started -> task_created -> task_started -> tool_started/tool_succeeded 반복 -> task_completed`
  2. 지시 흐름: `manager_assign -> agent_acknowledged -> meeting_started -> meeting_ended -> task_started -> task_completed`
  3. 실패 복구: `task_started -> tool_failed(pending_input) -> agent_unblocked -> tool_succeeded -> task_completed`
  4. 연속 실패: `task_started -> tool_failed x3 -> task_failed`
- 옵션:
  - `--agents N` (기본 5)
  - `--interval-ms` (기본 1000~5000 랜덤)
- 주입 대상:
  - `/ingest/hooks` 또는 내부 normalize 입력 경로
- 완료 기준:
  - 생성 시나리오로 Dashboard/Office/Agents 탭 상태가 모두 갱신됨

### 5.2 Ingest 구현 가드레일
- Hook 처리로 Claude Code 실행이 느려지지 않도록 `/ingest/hooks`는 즉시 응답한다.
- 수신 후 비동기 큐로 normalize/store/broadcast를 처리한다.

## 6. 릴리즈 전략
- Milestone 1: Dashboard-only 내부 검증
- Milestone 2: Office 시각화 포함 베타
- Milestone 3: Settings 포함 MVP 릴리즈
