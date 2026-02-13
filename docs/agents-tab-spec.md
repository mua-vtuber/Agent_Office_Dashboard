# Agents Tab Specification

## 1. 목적
에이전트의 정체성/역할/상태를 한눈에 파악하고, 저장형 에이전트와 임시 호출 에이전트를 명확히 구분한다.

## 2. 분류 라벨
- `정직원`
  - 프로젝트에 저장된 에이전트
  - 재사용 가능
  - 고정 아바타 사용
- `계약직`
  - 런타임에서 임시 생성/호출된 에이전트
  - 세션 종료 시 사라질 수 있음
  - 기본 아바타 또는 임시 아바타 사용

## 3. 화면 구성
- 좌측: 에이전트 목록
  - 아바타
  - 이름
  - 라벨(`정직원`/`계약직`)
  - 역할(`manager`/`worker`/기타)
  - 현재 상태
- 우측: 에이전트 상세
  - 소개(설명)
  - 사용 가능 툴
  - 전문 영역
  - 최근 작업/최근 이벤트

## 4. 필터/정렬
- 필터
  - 라벨: `all | 정직원 | 계약직`
  - 상태
  - 역할
- 정렬
  - 최근 활동 순
  - 이름순

## 5. 데이터 모델 초안
```json
{
  "agent_id": "worker_12",
  "display_name": "Refactor Worker",
  "employment_type": "employee",
  "role": "worker",
  "avatar_id": "avatar_worker_03",
  "status": "working",
  "is_persisted": true,
  "source": "project_agent"
}
```

- `employment_type`:
  - `employee` -> UI 라벨 `정직원`
  - `contractor` -> UI 라벨 `계약직`

## 6. 라벨 판정 규칙
- `is_persisted=true` 또는 `source=project_agent`면 `정직원`
- `is_persisted=false` 또는 `source=runtime_agent`면 `계약직`
- 정보가 없으면 기본 `계약직`으로 표시

## 7. 아바타 정책
- 정직원: `agent_id -> avatar_id` 고정 매핑
- 계약직: 기본 세트에서 임시 배정(세션 내 고정)

## 8. 연계 동작
- 목록 클릭 시 Office 탭에서 해당 에이전트 하이라이트
- 상세에서 "현재 위치 보기" 클릭 시 Office 탭으로 포커스 이동

## 9. MVP 범위
- 읽기 전용 목록/상세/필터
- 라벨 표시(`정직원`, `계약직`)
- Office 하이라이트 연동

## 10. 데이터 모델 (통합)
- `agent_id` string
- `display_name` string
- `role` enum(`manager`,`worker`,`specialist`,`unknown`)
- `employment_type` enum(`employee`,`contractor`)
- `is_persisted` boolean
- `source` enum(`project_agent`,`runtime_agent`,`unknown`)
- `avatar_id` string|null
- `status` string
- `last_active_ts` string

## 11. 상세 예시
```json
[
  {
    "agent_id": "manager_1",
    "display_name": "Team Manager",
    "role": "manager",
    "employment_type": "employee",
    "is_persisted": true,
    "source": "project_agent",
    "avatar_id": "avatar_mgr_01",
    "status": "meeting",
    "last_active_ts": "2026-02-13T16:00:00Z"
  },
  {
    "agent_id": "runtime_tmp_7",
    "display_name": "Hotfix Specialist",
    "role": "specialist",
    "employment_type": "contractor",
    "is_persisted": false,
    "source": "runtime_agent",
    "avatar_id": null,
    "status": "working",
    "last_active_ts": "2026-02-13T16:03:00Z"
  }
]
```
