# Office Layout Specification

## 1. 목적
Office 탭의 기본 좌석 구조를 실제 사무실 동선에 맞게 표준화한다.

## 2. 기본 레이아웃 프로필
- 프로필 ID: `kr_t_left_v2`
- 설명:
  - 좌측에 팀장 포함 T자 좌석 클러스터
  - 중앙에 팀원 좌석 블록
  - 우측에 탕비실 구역(싱크대/냉장고/전자레인지/테이블)
  - 좌하단 입구에서 우측 탕비실로 이어지는 빈 동선 확보

## 3. 공간 구역 정의 (0~100 정규화 좌표)
- `entrance_zone`: x 0~14, y 86~100
- `left_t_cluster`: x 10~30, y 14~72
- `center_worker_block`: x 42~62, y 14~72
- `pantry_zone`: x 76~100, y 0~100
- `pantry_door_lane`: x 64~78, y 84~96
- `meeting_lane`: x 32~48, y 26~70

## 4. 좌석 구조
- 팀장 좌석:
  - `left_t_cluster` 상단 헤드 위치
- 팀원 좌석:
  - 좌측 T 세로열(2열 x 3행)
  - 중앙 블록(2열 x 3행)
- 탕비실:
  - 근무 외 상태 에이전트의 기본 체류 가능 구역

## 5. 기본 좌표 예시
```json
{
  "layout_profile": "kr_t_left_v2",
  "zones": {
    "entrance_zone": {"x1": 0, "x2": 14, "y1": 86, "y2": 100},
    "left_t_cluster": {"x1": 10, "x2": 30, "y1": 14, "y2": 72},
    "center_worker_block": {"x1": 42, "x2": 62, "y1": 14, "y2": 72},
    "pantry_zone": {"x1": 76, "x2": 100, "y1": 0, "y2": 100},
    "pantry_door_lane": {"x1": 64, "x2": 78, "y1": 84, "y2": 96}
  },
  "seats": {
    "manager_1": {"x": 20, "y": 18, "zone": "left_t_cluster"},

    "worker_l1": {"x": 14, "y": 30, "zone": "left_t_cluster", "facing": "right"},
    "worker_l2": {"x": 24, "y": 30, "zone": "left_t_cluster", "facing": "left"},
    "worker_l3": {"x": 14, "y": 46, "zone": "left_t_cluster", "facing": "right"},
    "worker_l4": {"x": 24, "y": 46, "zone": "left_t_cluster", "facing": "left"},
    "worker_l5": {"x": 14, "y": 62, "zone": "left_t_cluster", "facing": "right"},
    "worker_l6": {"x": 24, "y": 62, "zone": "left_t_cluster", "facing": "left"},

    "worker_c1": {"x": 46, "y": 30, "zone": "center_worker_block", "facing": "right"},
    "worker_c2": {"x": 56, "y": 30, "zone": "center_worker_block", "facing": "left"},
    "worker_c3": {"x": 46, "y": 46, "zone": "center_worker_block", "facing": "right"},
    "worker_c4": {"x": 56, "y": 46, "zone": "center_worker_block", "facing": "left"},
    "worker_c5": {"x": 46, "y": 62, "zone": "center_worker_block", "facing": "right"},
    "worker_c6": {"x": 56, "y": 62, "zone": "center_worker_block", "facing": "left"}
  },
  "meeting_spots": [
    {"id": "m1", "x": 40, "y": 34},
    {"id": "m2", "x": 40, "y": 50},
    {"id": "m3", "x": 40, "y": 66}
  ]
}
```

## 6. 동선 규칙
- 입구 -> 업무 구역:
  - `entrance_zone`에서 시작해 중앙 빈 공간으로 진입
- 업무 구역 -> 탕비실:
  - `pantry_door_lane`을 통해 `pantry_zone`으로 이동
- manager -> worker 지시:
  - manager는 `left_t_cluster`에서 meeting spot으로 이동
  - worker는 현재 좌석에서 meeting spot으로 이동

## 6.1 meeting spot 할당 알고리즘
- 입력: `meeting_spots[]`, 참여 에이전트 현재 좌표, spot 점유 상태
- 규칙:
  1. 점유되지 않은 spot 중 참여자 합산 이동거리가 최소인 spot 선택
  2. 동률이면 `m1 -> m2 -> m3` 순서 우선
  3. 모든 spot 점유 시 대기열에 넣고, 가장 먼저 비는 spot 할당
- fallback:
  - spot 계산 실패 시 기본 `m1` 사용

## 7. 반응형 규칙
- 해상도별 안전영역 비율 유지
- 모바일/좁은 뷰포트에서는 구역 비율은 유지하고 좌표만 스케일 조정
- 캐릭터 겹침 발생 시 중앙 블록 세로 간격 우선 확대
