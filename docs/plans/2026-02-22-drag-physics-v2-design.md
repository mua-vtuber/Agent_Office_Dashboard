# 드래그 물리 개선 v2 Design

**Goal:** 드래그 물리의 3가지 문제를 수정한다 — X 경계 튕김, 바닥 X 관성, 실시간 충돌 밀기.

**Scope:** DragController 물리 계산 + CharacterManager 충돌 로직. 구조 변경 없음 (다중 물리는 별도 설계).

---

## 1. X 경계 튕김

### 현재 문제

벽에 닿으면 `vx = 0`으로 멈춤. 캐릭터 원점이 (중심축, 바닥)이라 벽에 반 걸린 채 떨어짐.

### 설계

- 벽 충돌 시 `vx = -vx * bounce_factor` (속도 반전 + 감쇠)
- `bounce_factor` = 0.5 (config 추가)
- 경계 판정: `container.getBounds()`의 좌우 끝 기준
  - 왼쪽 벽: `bounds.x < 0` → container.x를 `container.x - bounds.x`로 보정
  - 오른쪽 벽: `bounds.x + bounds.width > window.innerWidth` → 초과분만큼 보정
- flying + sliding 양쪽에 적용

### Config 추가

```toml
[drag]
bounce_factor = 0.5
```

---

## 2. 바닥 X 관성 (sliding)

### 현재 문제

pointerup 시 Y가 바닥이면 즉시 `handleLanding()` 호출 → X 관성 없이 그 자리에 멈춤.

### 설계

pointerup에서 바닥에 있어도 `|vx| > 1`이면 sliding 진입:

```
handlePointerUp:
  if (y >= groundY) {
    if (|vx| > 1) → phase = 'sliding', startPhysicsTicker()
    else → handleLanding() (즉시)
  } else {
    → phase = 'flying', startPhysicsTicker() (기존)
  }
```

sliding은 기존 로직 그대로 — `vx *= friction`, `|vx| < 1`이면 handleLanding.

---

## 3. 실시간 충돌 밀기

### 현재 문제

`resolveOverlap()`이 착지 순간에만 1회 실행. 드래그 중 다른 캐릭터를 밀어도 반응 없음. 착지 시에도 순간 이동이라 "밀리는" 느낌이 없음.

### 설계

#### 충돌 감지

매 프레임 이동 중인 캐릭터(드래그 또는 물리)와 다른 캐릭터의 Spine 바운드 겹침을 체크.

```
for each otherCharacter:
  if (otherCharacter === movingCharacter) continue
  if (otherCharacter.isDragged) continue

  aBounds = movingCharacter.container.getBounds()
  bBounds = otherCharacter.container.getBounds()

  overlapX = 겹침 깊이 계산
  if (overlapX > 0) → 밀기 처리
```

겹침 깊이 계산 (AABB):
```
overlapX = min(aRight, bRight) - max(aLeft, bLeft)
overlapY = min(aBottom, bBottom) - max(aTop, bTop)
둘 다 > 0이면 겹침. overlapX 사용.
```

#### 밀기 처리 (관성 방식)

겹침 감지 시 밀리는 캐릭터에 속도를 부여:

```
direction = otherCharacter가 오른쪽이면 +1, 왼쪽이면 -1
pushVx = direction * (overlapX + collision_padding) * push_strength
otherCharacter에 pushVx를 적용
```

- `collision_padding`: 포즈 변화 여유분 (px). 겹침 깊이에 더해서 약간 더 밀어냄.
- `push_strength`: 밀기 강도 계수. 겹침이 깊을수록 세게 밀림.
- 밀린 캐릭터는 `vx *= friction`으로 자연 감속.

#### 밀린 캐릭터 물리

밀린 캐릭터는 별도의 "pushed" 상태로 관리:
- DragController에 `pushedCharacters: Map<string, { character, vx }>` 추가
- 물리 ticker에서 pushed 캐릭터들도 매 프레임 `vx *= friction` + 이동
- `|vx| < 1`이면 정지 → pushed에서 제거, homeX 갱신

#### 연쇄 충돌

pushed 캐릭터가 이동하면서 또 다른 캐릭터에 부딪힐 수 있음.
한 프레임에 충돌 체크를 최대 2회 반복하여 연쇄 처리.

#### 적용 시점

- `handlePointerMove` — 드래그 중 매 프레임
- `tickPhysics` — 물리 시뮬레이션 중 매 프레임

#### 기존 resolveOverlap

CharacterManager의 `resolveOverlap()` 메서드 제거. 실시간 충돌이 완전히 대체.

### Config 추가

```toml
[drag]
collision_padding = 5
push_strength = 8.0
```

---

## Config 전체 (변경 후)

```toml
[drag]
poll_interval_ms = 16
hit_padding_px = 15
gravity = 1800.0
friction = 0.92
max_throw_speed = 1500.0
velocity_samples = 5
bounce_factor = 0.5
collision_padding = 5
push_strength = 8.0
```

---

## 변경 파일 요약

| 파일 | 변경 |
|------|------|
| `src-tauri/src/config.rs` | DragConfig에 bounce_factor, collision_padding, push_strength 추가 + 검증 |
| `src-tauri/config.toml` | 새 필드 값 추가 |
| `src-tauri/src/commands/agents.rs` | DisplayConfigResponse에 새 필드 추가 |
| `apps/webview/src/types/ipc.ts` | DisplayConfig에 새 필드 추가 |
| `apps/webview/src/pixi/DragController.ts` | 벽 튕김, 바닥 sliding, 실시간 충돌+밀기, pushed 캐릭터 관리 |
| `apps/webview/src/pixi/CharacterManager.ts` | resolveOverlap 제거 |

## 물리 상태 흐름 (변경 후)

```
idle ─[pointerdown]─→ dragging
                         │ 매 프레임: 충돌 체크 + 밀기
                   [pointerup]
                         │
          ┌──────────────┴──────────────┐
          │ 공중                         │ 바닥
          ▼                             │
       flying                    ┌──────┴──────┐
       gravity + friction        │ |vx| > 1     │ |vx| ≤ 1
       벽 튕김 (bounce)          ▼             ▼
       충돌 체크 + 밀기       sliding      handleLanding
          │                  friction
   [y >= groundY]            벽 튕김
          │                  충돌 체크 + 밀기
       sliding                  │
          │                [|vx| < 1]
   [|vx| < 1]                  │
          │                handleLanding
       handleLanding

pushed 캐릭터 (별도):
  충돌 → vx 부여 → friction 감속 → |vx| < 1 → 정지 + homeX 갱신
```
