# Session Tracking and Dashboard Routing

## 1. 문제
여러 터미널에서 동시에 서로 다른 작업을 수행할 때,
사용자가 "어떤 터미널의 상태"를 보고 있는지 명확해야 한다.

## 2. 식별자 모델
- `workspace_id`: 프로젝트/레포 단위
- `terminal_session_id`: 터미널 인스턴스 단위
- `run_id`: 동일 터미널 내 실행 단위

권장 조합 키:
- `scope_key = workspace_id + terminal_session_id + run_id`

## 3. 수집기 측 추적
- 모든 ingest 이벤트에 3개 식별자 포함
- 식별자 누락 시:
  - `workspace_id`: repo_name 기반 자동 생성
  - `terminal_session_id`: 서버 생성값으로 보정
  - `run_id`: 세션 시작 시각 기반 생성
- 10초 간격 `heartbeat`로 활성 세션 유지

## 4. 사용자 접속 방식 (웹 대시보드 열기)

### 4.1 기본 진입
- URL: `/dashboard`
- 동작: 현재 활성 `workspace_id` 목록 표시

### 4.2 워크스페이스 단위 보기
- URL: `/dashboard?workspace_id=repo_agent-office-dashboard`
- 동작: 해당 프로젝트의 모든 터미널 세션 통합 뷰

### 4.3 특정 터미널 보기
- URL: `/dashboard?workspace_id=repo_agent-office-dashboard&terminal_session_id=term_a1b2c3`
- 동작: 해당 터미널 이벤트/상태만 필터링

### 4.4 특정 실행(run) 보기
- URL: `/dashboard?workspace_id=repo_agent-office-dashboard&terminal_session_id=term_a1b2c3&run_id=run_1`
- 동작: 한 실행 단위 타임라인만 표시

## 5. 권장 UX
- 상단 스코프 바 제공:
  - Workspace 선택
  - Terminal Session 선택
  - Run 선택
- 스코프 변경 시 URL 쿼리 동기화
- 즐겨찾기 가능한 고정 링크 제공

## 6. 터미널에서 여는 방법
- 터미널 시작 시 session 정보 출력:
  - `workspace_id=...`
  - `terminal_session_id=...`
  - `run_id=...`
- 함께 출력되는 링크를 브라우저에서 열기:
  - `http://localhost:3000/dashboard?workspace_id=...&terminal_session_id=...&run_id=...`

## 7. 불일치 방지
- 클라이언트는 30초마다 snapshot 재동기화
- 선택한 스코프의 heartbeat가 끊기면 "inactive" 배지 표시
