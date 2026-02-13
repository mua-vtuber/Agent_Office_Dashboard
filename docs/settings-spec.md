# Settings Specification

## 1. 목적
운영자가 대시보드 동작을 코드 수정 없이 제어할 수 있게 한다.

## 2. 설정 범주

### 2.1 General
- `language`: `ko`, `en` (초기)
- `timezone`: 예) `Asia/Seoul`, `UTC`
- `date_format`: `relative | absolute`
- `theme`: `office-light | office-dark` (확장 가능)
- `animation_speed`: `slow | normal | fast`

### 2.2 i18n
- `fallback_language`: 기본 `en`
- `number_locale`: 숫자 포맷 로케일
- `event_message_locale_mode`: `ui_locale | event_locale`
  - `ui_locale`: 사용자 UI 언어 기준 번역
  - `event_locale`: 이벤트 발생 언어 우선

### 2.3 Office Layout
- `layout_profile`: 기본 `kr_t_left_v2`
- `seat_positions`: agent별 좌석 좌표
- `meeting_spots`: 고정 미팅 위치 목록
- `pantry_zone_enabled`: 기본 true
- `pantry_door_lane`: 탕비실 진입 동선 좌표
- `speech_bubble_enabled`: 말풍선 on/off
- `status_icon_enabled`: 상태 아이콘 on/off

### 2.4 Operations
- `idle_to_breakroom_seconds`: 기본 180
- `idle_to_resting_seconds`: 기본 240
- `post_complete_policy`: `weighted_random | roaming_only | breakroom_only | resting_only`
- `post_complete_weights`: `{roaming:0.4, breakroom:0.4, resting:0.2}`
- `pending_input_alert_seconds`: 기본 60
- `failed_alert_seconds`: 기본 30
- `stale_agent_seconds`: 기본 30
- `failure_alert_enabled`: boolean
- `snapshot_sync_interval_sec`: 기본 30

### 2.5 Connection
- `api_base_url`
- `ws_url`
- `ingest_token_ref` (실제 토큰은 비밀 저장소)
- `masking_keys`: 기본 `["password","token","secret","api_key"]`

### 2.6 Session Tracking
- `workspace_id_strategy`: `repo_name | explicit`
- `terminal_session_id_strategy`: `env | generated`
- `default_view_scope`: `workspace | terminal_session | all`
- `heartbeat_interval_sec`: 기본 10

### 2.7 Motion and Effects
- `working_paper_effect_enabled`: 기본 true
- `failed_scream_motion_enabled`: 기본 true
- `resting_zzz_effect_enabled`: 기본 true
- `motion_intensity`: `low | normal | high`

### 2.8 Advanced
- `transition_rules_editable`: 기본 false
- `event_sampling_noncritical`: 0~1
- `rate_limit_per_session_per_sec`

## 3. 기본값 예시
```json
{
  "general": {
    "language": "ko",
    "timezone": "Asia/Seoul",
    "date_format": "relative",
    "theme": "office-light",
    "animation_speed": "normal"
  },
  "office_layout": {
    "layout_profile": "kr_t_left_v2",
    "pantry_zone_enabled": true
  },
  "i18n": {
    "fallback_language": "en",
    "number_locale": "ko-KR",
    "event_message_locale_mode": "ui_locale"
  },
  "operations": {
    "idle_to_breakroom_seconds": 180,
    "idle_to_resting_seconds": 240,
    "post_complete_policy": "weighted_random",
    "post_complete_weights": {"roaming": 0.4, "breakroom": 0.4, "resting": 0.2},
    "pending_input_alert_seconds": 60,
    "failed_alert_seconds": 30,
    "stale_agent_seconds": 30,
    "failure_alert_enabled": true,
    "snapshot_sync_interval_sec": 30
  },
  "motion_effects": {
    "working_paper_effect_enabled": true,
    "failed_scream_motion_enabled": true,
    "resting_zzz_effect_enabled": true,
    "motion_intensity": "normal"
  },
  "session_tracking": {
    "workspace_id_strategy": "repo_name",
    "terminal_session_id_strategy": "env",
    "default_view_scope": "workspace",
    "heartbeat_interval_sec": 10
  }
}
```

## 4. 유효성 규칙
- `language`는 지원 언어 목록 내 값만 허용
- `snapshot_sync_interval_sec`는 5~300 범위
- `heartbeat_interval_sec`는 2~60 범위
- `meeting_spots`는 최소 1개 필요

## 5. 권한
- 읽기: 운영자/관찰자
- 수정: 관리자만
- 고급 설정(`advanced`) 수정은 관리자 + 확인 절차 필요
