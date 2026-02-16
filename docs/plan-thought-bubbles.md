# Agent Thought Bubbles — 설계 및 구현 계획

## 개요

Claude API의 extended thinking 데이터를 대시보드에서 실시간으로 보여주는 기능.
에이전트의 "속마음"을 thought bubble(구름 말풍선)로 시각화한다.

## 아키텍처

```
Claude Code Hook (Stop event)
  │  message.content = [{ type: "thinking", thinking: "..." }, { type: "text", ... }]
  ▼
POST /ingest/hooks
  │  normalizer: raw payload에서 thinking 블록 추출
  ▼
Backend Translation Service (선택적)
  │  settings.thought_bubble.translation.enabled && api_key 설정 시
  │  → Claude/OpenAI-compatible API로 번역
  │  → 미설정 시: 원문(영어) 그대로
  │  → 설정됐는데 실패 시: 에러 표시 (silent fallback 없음)
  ▼
state_current 테이블 (thinking_text 컬럼 추가)
  │
  ├─ WebSocket broadcast: state_update에 thinking 포함
  ├─ GET /api/snapshot: agents에 thinking 포함
  └─ events.payload_json: thinking 원문 보존
  ▼
Frontend
  │  AgentView.thinking 필드 추가
  │  ws-store: state_update에서 thinking 추출
  ▼
  ├─ OfficePage: PixiJS 구름 모양 thought bubble
  ├─ DashboardPage: agent card에 thinking 표시
  └─ AgentsPage: 상세 패널에 thinking 표시
```

## Phase 1: Schema & Shared Types

### 수정 파일
- `packages/shared-schema/src/settings.ts` — `thought_bubble` 섹션 추가
- `packages/shared-schema/src/state.ts` — `AgentState.thinking` 필드 추가

### Settings 추가 스키마

```typescript
thought_bubble: {
  enabled: boolean,                    // thought bubble 표시 여부
  max_length: number,                  // 말풍선 표시 최대 글자수
  translation: {
    enabled: boolean,                  // 번역 활성화 여부
    api_endpoint: string,              // API endpoint URL
    api_key: string,                   // API key
    model: string,                     // 모델명
    target_language: string,           // 번역 대상 언어
  }
}
```

## Phase 2: Backend — Normalizer & Storage

### 수정 파일
- `apps/backend/src/services/normalizer.ts` — thinking 추출 로직
- `apps/backend/src/storage/db.ts` — migration v2: `state_current.thinking_text` 컬럼
- `apps/backend/src/storage/state-repo.ts` — `StateRow`에 `thinking_text` 추가

### Thinking 추출 전략
- `Stop` 이벤트의 `raw.payload.message.content` 배열에서 `type === "thinking"` 블록
- 여러 thinking 블록이 있으면 마지막 것 사용
- thinking이 없는 이벤트는 이전 값 유지 (null로 덮어쓰지 않음)

## Phase 3: Backend — Translation Service

### 신규 파일
- `apps/backend/src/services/translator.ts`

### 설계
- Settings에서 `thought_bubble.translation` 설정을 읽어서 동작
- `enabled: false`이거나 `api_key` 미설정 → 원문 반환
- `enabled: true` + `api_key` 설정 → API 호출로 번역
- API 호출 실패 → 에러 메시지 반환 (`[Translation Error: reason]`)
- 프롬프트: 간결한 번역만 출력

## Phase 4: Backend — Ingest & Broadcast 통합

### 수정 파일
- `apps/backend/src/routes/ingest.ts` — thinking → 번역 → state → broadcast
- `apps/backend/src/routes/snapshot.ts` — snapshot에 thinking 포함

### 데이터 흐름
1. normalizer에서 `payload.thinking` 추출
2. translator로 번역 (설정에 따라)
3. `state_current.thinking_text`에 저장
4. `state_update` broadcast에 `thinking` 필드 포함
5. snapshot API에서 `thinking_text` 반환

## Phase 5: Frontend — Store & WebSocket

### 수정 파일
- `apps/frontend/src/stores/agent-store.ts` — `AgentView.thinking` 추가
- `apps/frontend/src/stores/ws-store.ts` — `state_update`에서 `thinking` 추출

## Phase 6: Frontend — Settings UI

### 수정 파일
- `apps/frontend/src/pages/SettingsPage.tsx` — Thought Bubble 설정 패널
- `apps/frontend/src/i18n/index.ts` — 번역 키 추가

### 설정 UI 항목
- Thought Bubble 활성화 토글
- 최대 글자수 입력
- 번역: 활성화 토글, API endpoint, API key (password), 모델명, 대상 언어
- 저장 → `PUT /api/settings/app`

## Phase 7: Frontend — Thought Bubble UI

### 수정 파일
- `apps/frontend/src/pages/OfficePage.tsx` — PixiJS thought bubble (구름 모양)
- `apps/frontend/src/pages/DashboardPage.tsx` — agent card에 thinking
- `apps/frontend/src/pages/AgentsPage.tsx` — 상세 패널에 thinking

### OfficePage 변경 사항
- `bubbleLabel()` → thinking 데이터 기반 (하드코딩 제거)
- 구름 모양 thought bubble 스타일
- `settings.thought_bubble.enabled` 체크
- `max_length`로 텍스트 truncate
- thinking 없는 에이전트는 기존 status 기반 표시

## 수정 파일 전체 목록

| Phase | 파일 | 작업 |
|-------|------|------|
| 1 | `shared-schema/src/settings.ts` | thought_bubble 스키마 + 기본값 |
| 1 | `shared-schema/src/state.ts` | AgentState.thinking 추가 |
| 2 | `backend/src/services/normalizer.ts` | thinking 추출 |
| 2 | `backend/src/storage/db.ts` | migration v2 |
| 2 | `backend/src/storage/state-repo.ts` | thinking_text 컬럼 |
| 3 | `backend/src/services/translator.ts` | **신규** — 번역 서비스 |
| 4 | `backend/src/routes/ingest.ts` | 번역 통합 + broadcast |
| 4 | `backend/src/routes/snapshot.ts` | thinking 포함 |
| 5 | `frontend/src/stores/agent-store.ts` | thinking 필드 |
| 5 | `frontend/src/stores/ws-store.ts` | thinking 핸들링 |
| 6 | `frontend/src/pages/SettingsPage.tsx` | 설정 UI |
| 6 | `frontend/src/i18n/index.ts` | 번역 키 |
| 7 | `frontend/src/pages/OfficePage.tsx` | thought bubble UI |
| 7 | `frontend/src/pages/DashboardPage.tsx` | thinking 표시 |
| 7 | `frontend/src/pages/AgentsPage.tsx` | thinking 표시 |

## 실행 규칙

| # | 규칙 | 적용 |
|---|------|------|
| 1 | 코드품질 우선 | TypeScript strict, Zod validation, 명확한 타입 |
| 2 | 구조적 효율 | 번역 서비스 분리, settings 기반 동적 설정 |
| 3 | 하드코딩 금지 | 모든 값은 settings/constants에서 읽기 |
| 4 | 폴백 대신 에러 | 번역 실패 시 에러 메시지 표시 |
| 5 | 필요시 재작성 | bubbleLabel 등 기존 하드코딩 코드 재작성 |
| 6 | 오류 통과 진행 | 중간 오류 발생해도 목표 방향 유지 |
| 7 | Phase별 커밋 | 각 Phase 완료 후 검증 + commit + push |
| 8 | 허가 없이 끝까지 | 중간에 사용자 확인 불필요, 완료 후 전체 검증 |
