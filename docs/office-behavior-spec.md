# Office Behavior and Motion Spec

## 1. 목적
에이전트 상태를 사람이 직관적으로 이해할 수 있도록 행동/모션/이펙트를 표준화한다.

## 2. 상태별 시각 규칙
- `working`
  - 자리 고정
  - 머리 위 흰 종이(작업표시) + 줄이 그어지는 애니메이션
- `pending_input`
  - 자리 또는 meeting 이후 정지
  - 생각/대기 표시 아이콘
- `failed`
  - 절규/패닉 모션(짧은 상하 진동 + 팔 흔들림 스타일)
  - 머리 위 경고 아이콘
- `completed`
  - 완료 직후 상태. 다음 행동 정책으로 분기
- `roaming`
  - 사무실 순찰 이동(업무구역 랜덤 경로)
- `breakroom`
  - 탕비실 이동 후 체류
- `resting`
  - 좌석에서 `Zzz` 수면 이펙트

## 3. 완료 후 행동 정책
기본 정책 `post_complete_policy = weighted_random`
- `roaming`: 0.4
- `breakroom`: 0.4
- `resting`: 0.2

운영자가 Settings에서 비율 조정 가능.

## 4. 비작업 상태 정책
- 명시적 업무가 없고 idle 시간이 임계치를 넘으면:
  - `breakroom`으로 이동하거나
  - 좌석 `resting`으로 전환

## 5. 이벤트 매핑
- `task_started` -> `working`
- `task_completed` -> `completed` -> (`roaming`|`breakroom`|`resting`)
- `task_failed` 또는 치명 `tool_failed` -> `failed`
- 복구 이벤트 -> `working` 또는 `idle`

## 6. 이펙트 사양 (MVP)
- working paper:
  - 흰 사각형 1개
  - 3~5개 획(line) 반복 드로잉
  - 0.7~1.2초 루프
- failed scream:
  - x축 미세 흔들림(2~4px)
  - y축 바운스(1~2px)
  - 0.25초 주기
- resting zzz:
  - `Z`, `Zz`, `Zzz` 순환
  - 1.5초 주기 fade in/out

## 7. 접근성
- 모션 강도 설정(`low`, `normal`, `high`)
- `reduced_motion` 사용자는 흔들림/바운스를 단순 아이콘 변경으로 대체
