# Settings Specification

## 1. 목적
운영자가 코드 수정 없이 대시보드 동작을 제어한다.

## 2. 설정 범주

### 2.1 General
- `language`: `ko | en`
- `timezone`: IANA timezone
- `date_format`: `relative | absolute`
- `theme`: `office-light | office-dark`
- `animation_speed`: `slow | normal | fast`

### 2.2 i18n
- `fallback_language`: `ko | en`
- `number_locale`: 예) `ko-KR`
- `event_message_locale_mode`: `ui_locale | event_locale`

### 2.3 Office Layout
- `layout_profile`: 기본 `kr_t_left_v2`
- `canvas_width`, `canvas_height`: 캔버스 크기(px)
- `seat_positions`: 좌석 좌표 맵
- `meeting_spots`: 미팅 포인트 좌표 맵
- `zones`
  - `left_cluster`
  - `center_block`
  - `pantry_zone`
  - `meeting_lane`
  - `roam_zone`
- `pantry_zone_enabled`
- `pantry_door_lane`
- `speech_bubble_enabled`
- `status_icon_enabled`

### 2.4 Operations
- `idle_to_breakroom_seconds`
- `idle_to_resting_seconds`
- `post_complete_policy`: `weighted_random | roaming_only | breakroom_only | resting_only`
- `post_complete_weights`
- `pending_input_alert_seconds`
- `failed_alert_seconds`
- `stale_agent_seconds`
- `failure_alert_enabled`
- `snapshot_sync_interval_sec`
- `move_speed_px_per_sec`

### 2.5 Connection
- `api_base_url`
- `ws_url`
- `masking_keys`

### 2.6 Session Tracking
- `workspace_id_strategy`: `repo_name | explicit`
- `terminal_session_id_strategy`: `env | generated`
- `default_view_scope`: `workspace | terminal_session | all`
- `heartbeat_interval_sec`

### 2.7 Motion and Effects
- `working_paper_effect_enabled`
- `failed_scream_motion_enabled`
- `resting_zzz_effect_enabled`
- `motion_intensity`: `low | normal | high`

### 2.8 Thought Bubble
- `enabled`
- `max_length`
- `translation`
  - `enabled`
  - `api_endpoint`
  - `api_key`
  - `model`
  - `target_language`

### 2.9 Dynamic Transition Rules (선택)
- `transition_rules[]`
  - `from`
  - `event`
  - `to`

## 3. 기본값 기준
기준 소스: `packages/shared-schema/src/settings.ts`의 `defaultSettings`.

## 4. 유효성 규칙
- `snapshot_sync_interval_sec`: 5~300
- `move_speed_px_per_sec`: 30~300
- `heartbeat_interval_sec`: 2~60
- `canvas_width`: 320~4096
- `canvas_height`: 240~4096
- `thought_bubble.max_length`: 10~500
