# Agent Mascot - Spine Character Specification

## 1. 목적

Spine 2D 스켈레탈 애니메이션으로 에이전트 캐릭터를 표현한다.
스킨 시스템으로 에이전트별 고유 외형을 생성하고, 상태별 애니메이션으로 활동을 시각화한다.

기존 SVG 레이어 + 팔레트 스왑 방식을 Spine으로 완전히 대체한다.

## 2. 스켈레톤 구조

### 2.1 뼈대 (Bone Hierarchy)

```
root
 └─ body
     ├─ torso
     │   ├─ arm-left
     │   │   └─ hand-left
     │   └─ arm-right
     │       └─ hand-right
     ├─ leg-left
     │   └─ foot-left
     ├─ leg-right
     │   └─ foot-right
     └─ head
         ├─ face
         └─ hair
```

이 구조는 가이드라인이며, 실제 리깅은 Spine 작업자의 판단에 따른다.
중요한 것은 **스킨 슬롯 규약**과 **필수 애니메이션 목록**을 준수하는 것이다.

### 2.2 스킨 슬롯 (Skin Slots)

런타임에서 조합할 수 있도록, 다음 슬롯 그룹별로 스킨을 정의한다:

| 슬롯 그룹 | 네이밍 규약 | 설명 | 예시 |
|-----------|------------|------|------|
| `body` | `body/type-{N}` | 체형 | `body/type-0`, `body/type-1` |
| `hair` | `hair/style-{N}` | 머리 스타일 | `hair/style-0` ~ `hair/style-5` |
| `outfit` | `outfit/style-{N}` | 의상 | `outfit/style-0` ~ `outfit/style-4` |
| `accessory` | `accessory/item-{N}` | 악세서리 (선택) | `accessory/item-1` ~ `accessory/item-3` |
| `face` | `face/type-{N}` | 표정 세트 | `face/type-0`, `face/type-1` |

- 인덱스 `{N}`은 0부터 시작
- 각 그룹의 스킨 개수는 고정되지 않음 — **런타임에 Spine 파일에서 읽어옴**
- `accessory`는 선택적: 인덱스 0이면 악세서리 없음

### 2.3 스킨 조합 규칙

런타임에서 여러 스킨을 합성하여 하나의 커스텀 스킨을 만든다:

```typescript
const customSkin = new Skin('agent-custom');
customSkin.addSkin(skeletonData.findSkin(`body/type-${profile.body_index}`));
customSkin.addSkin(skeletonData.findSkin(`hair/style-${profile.hair_index}`));
customSkin.addSkin(skeletonData.findSkin(`outfit/style-${profile.outfit_index}`));

if (profile.accessory_index > 0) {
  customSkin.addSkin(skeletonData.findSkin(`accessory/item-${profile.accessory_index}`));
}

customSkin.addSkin(skeletonData.findSkin(`face/type-${profile.face_index}`));

skeleton.setSkin(customSkin);
skeleton.setSlotsToSetupPose();
```

## 3. 외형 결정 알고리즘

기존 캐릭터 시스템의 결정적 PRNG를 계승한다.

### 3.1 시드 생성

```rust
pub fn hash_seed(agent_id: &str) -> u32 {
    let mut h: u32 = 0;
    for byte in agent_id.bytes() {
        h = h.wrapping_mul(31).wrapping_add(byte as u32);
    }
    h
}
```

### 3.2 Mulberry32 PRNG

```rust
pub struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut t = self.state ^ (self.state >> 15);
        t = t.wrapping_mul(1 | self.state);
        t = (t.wrapping_add(t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }

    pub fn next_index(&mut self, count: usize) -> usize {
        (self.next_f64() * count as f64) as usize
    }
}
```

### 3.3 외형 프로필 생성

```rust
pub struct AppearanceProfile {
    pub body_index: usize,
    pub hair_index: usize,
    pub outfit_index: usize,
    pub accessory_index: usize,  // 0 = 없음
    pub face_index: usize,
    pub hair_hue: f64,           // 0.0 ~ 360.0
    pub outfit_hue: f64,         // 0.0 ~ 360.0
    pub skin_hue: f64,           // 0.0 ~ 360.0
    pub skin_lightness: f64,     // config 범위 내
}

pub fn generate_appearance(
    agent_id: &str,
    slot_counts: &SlotCounts,
    config: &AppearanceConfig,
) -> AppearanceProfile {
    let seed = hash_seed(agent_id);
    let mut rng = Mulberry32::new(seed);

    AppearanceProfile {
        body_index: rng.next_index(slot_counts.body),
        hair_index: rng.next_index(slot_counts.hair),
        outfit_index: rng.next_index(slot_counts.outfit),
        accessory_index: rng.next_index(slot_counts.accessory + 1), // +1 for "없음"
        face_index: rng.next_index(slot_counts.face),
        hair_hue: rng.next_f64() * 360.0,
        outfit_hue: rng.next_f64() * 360.0,
        skin_hue: rng.next_f64() * 360.0,
        skin_lightness: config.skin_lightness_min
            + rng.next_f64() * (config.skin_lightness_max - config.skin_lightness_min),
    }
}
```

### 3.4 SlotCounts

스킨 개수는 하드코딩하지 않는다. WebView가 Spine 스켈레톤을 로드한 후 스킨 이름을 파싱하여 Rust에 전달한다:

```typescript
function extractSlotCounts(skeletonData: SkeletonData): SlotCounts {
    const skins = skeletonData.skins;
    const counts = { body: 0, hair: 0, outfit: 0, accessory: 0, face: 0 };

    for (const skin of skins) {
        if (skin.name.startsWith('body/type-')) counts.body++;
        else if (skin.name.startsWith('hair/style-')) counts.hair++;
        else if (skin.name.startsWith('outfit/style-')) counts.outfit++;
        else if (skin.name.startsWith('accessory/item-')) counts.accessory++;
        else if (skin.name.startsWith('face/type-')) counts.face++;
    }

    return counts;
}
```

## 4. 색조 틴팅

Spine 스킨은 형태(shape)를 결정하고, 색상은 런타임에서 슬롯 컬러로 조절한다.

### 4.1 틴팅 대상 슬롯

| 슬롯 | 색상 소스 | 적용 방식 |
|------|----------|-----------|
| 머리카락 관련 슬롯 | `hair_hue` | HSL → RGB → slot.color |
| 의상 관련 슬롯 | `outfit_hue` | HSL → RGB → slot.color |
| 피부 관련 슬롯 | `skin_hue` + `skin_lightness` | 파스텔 HSL → RGB → slot.color |

### 4.2 HSL → Spine Color 변환

```typescript
function applyHueTint(skeleton: Skeleton, slotName: string, hue: number, saturation: number, lightness: number) {
    const slot = skeleton.findSlot(slotName);
    if (!slot) return;

    const [r, g, b] = hslToRgb(hue / 360, saturation / 100, lightness / 100);
    slot.color.set(r, g, b, 1);
}
```

피부색은 파스텔 계열로 제한한다:
- 채도: config `skin_saturation_min` ~ `skin_saturation_max` (기본 25 ~ 54)
- 명도: config `skin_lightness_min` ~ `skin_lightness_max` (기본 75 ~ 89)

## 5. 필수 애니메이션 목록

| 애니메이션 이름 | 타입 | 설명 | 예상 길이 |
|---------------|------|------|-----------|
| `appear` | one-shot | 등장. 뿅 이펙트와 함께. | 0.5초 |
| `idle` | loop | 대기. 숨쉬기, 눈 깜빡. | 3초 |
| `working` | loop | 작업 중. 타이핑 동작. | 2초 |
| `thinking` | loop | 생각 중. 머리 갸웃, 손 턱. | 2.5초 |
| `failed` | one-shot + hold | 실패. 충격/패닉. 마지막 프레임 유지. | 1초 |
| `celebrate` | one-shot | 작업 완료 기쁨! 폴짝폴짝 뛰기. | 1.5초 |
| `resting` | loop | 졸기. 눈 감고 고개 숙이고 Zzz. | 4초 |
| `startled` | one-shot | 화들짝! 눈 크게 뜨고 깜짝 놀람. | 0.5초 |
| `walking` | loop | 걷기. 다른 에이전트에게 다가감/복귀. | 0.6초 |
| `chatting` | loop | 대화 중. 고개 끄덕, 손짓. | 2초 |
| `disappear` | one-shot | 퇴장. 등장의 역재생 또는 별도 연출. | 0.5초 |

### 5.1 애니메이션 전환 (Mix)

Spine의 `AnimationStateData`에서 애니메이션 간 mix 시간을 정의한다:

```
idle → working: 0.2초
working → idle: 0.2초
idle → thinking: 0.3초
thinking → working: 0.2초
working → failed: 0.1초 (빠른 전환)
idle → resting: 0.5초 (천천히 졸기 시작)
resting → startled: 0초 (즉시! 화들짝)
startled → working: 0.2초
idle → walking: 0.2초
walking → chatting: 0.2초
chatting → walking: 0.2초 (복귀 시작)
walking → idle: 0.2초
* → appear: 0초 (즉시)
* → disappear: 0초 (즉시)
```

### 5.2 celebrate 후 전환

`completed` 상태 진입 시:
1. `celebrate` 애니메이션 재생 (one-shot)
2. 완료 후 `idle` 루프로 자동 전환
3. 타이머 만료 시 `disappearing` → `disappear` 애니메이션

## 6. 캐릭터 배치

### 6.1 활동 영역

캐릭터는 **화면 하단 작업표시줄 바로 위 영역**에만 존재한다.

```
config.toml:
[display]
activity_zone_height_px = 120    # 활동 영역 높이
taskbar_offset_px = 48           # 작업표시줄 높이 (OS별 다름)
```

- 캐릭터 Y좌표: `screen_height - taskbar_offset - character_height`
- 활동 영역 위의 공간은 말풍선과 라벨만 표시
- 화면 중앙이나 상단으로 절대 이동하지 않음

### 6.2 워크스페이스 그룹 배치

```
[그룹A: my-project]              [그룹B: api-server]
  ←group_spacing→                  ←group_spacing→
 agent-01  agent-02   ← char_spacing →  leader  worker-01
```

- 같은 워크스페이스의 캐릭터: `character_spacing_px` 간격
- 그룹 간: `group_spacing_px` 간격 (더 넓음)
- 그룹 순서: 등장 순서 (먼저 나타난 워크스페이스가 왼쪽)

### 6.3 idle 미세 움직임

idle 상태에서 캐릭터가 완전히 정지해 있으면 부자연스러우므로:
- Spine `idle` 애니메이션 자체에 미세한 몸 흔들림 포함
- 추가로 좌우 1~2px 정도의 미세 이동은 허용 (config `idle_sway_px`)
- 절대 다른 캐릭터의 영역을 침범하지 않음

## 7. PixiJS 통합

### 7.1 의존성

```json
{
  "@esotericsoftware/spine-pixi": "^4.2",
  "pixi.js": "^8.0"
}
```

### 7.2 로드 흐름

```typescript
// 1. Spine 에셋 로드
import { SpineTexture } from '@esotericsoftware/spine-pixi';

const skeletonData = await Assets.load({
    alias: 'character',
    src: '/assets/spine/character.json',
});

// 2. SlotCounts 추출 → Rust에 전달
const slotCounts = extractSlotCounts(skeletonData);
await invoke('set_slot_counts', { slotCounts });

// 3. 로드 실패 시 에러 오버레이 표시 (폴백 없음)
```

### 7.3 SpineCharacter 클래스

```typescript
class SpineCharacter {
    readonly spine: Spine;
    readonly agentId: string;
    private bubble: SpeechBubble;
    private nameLabel: Text;
    private currentAnim: string;

    constructor(skeletonData: SkeletonData, agentId: string, appearance: AppearanceProfile);

    applySkin(appearance: AppearanceProfile): void;
    applyColorTints(appearance: AppearanceProfile): void;
    transitionTo(status: AgentStatus): void;
    updateBubble(text: string | null): void;
    destroy(): void;
}
```

## 8. Spine 에셋 제작 가이드

### 8.1 파일 구조

Spine 에디터에서 export 시 생성되는 파일:

```
assets/spine/
  character.json        # 스켈레톤 데이터 (JSON export)
  character.atlas       # 텍스처 아틀라스
  character.png         # 텍스처 이미지
```

### 8.2 제작 체크리스트

- [ ] 뼈대 리깅 완료
- [ ] 스킨 슬롯 네이밍 규약 준수 (`body/type-N`, `hair/style-N` 등)
- [ ] 최소 1개 이상의 스킨이 각 슬롯 그룹에 존재
- [ ] 11개 필수 애니메이션 제작 (`appear`, `idle`, `working`, `thinking`, `failed`, `celebrate`, `resting`, `startled`, `walking`, `chatting`, `disappear`)
- [ ] 애니메이션 mix 시간 설정
- [ ] 틴팅 대상 슬롯에 흰색 또는 밝은 회색 기본색 사용 (곱하기 틴팅이므로)
- [ ] JSON export (Binary 아님)

### 8.3 주의사항

- 스킨 이름은 정확한 규약을 따라야 함 — 런타임에서 prefix 매칭으로 자동 탐색
- 틴팅이 잘 보이려면 기본 텍스처를 밝은 색으로 제작
- 캐릭터 크기: 활동 영역 높이(config)에 맞게 스케일 조절됨

## 9. 결정 로그

| 날짜 | 결정 | 이유 |
|------|------|------|
| 2026-02-20 | SVG 레이어 → Spine 2D 전환 | 사용자가 Spine 작업 가능, 프로 품질 애니메이션 |
| 2026-02-20 | 스킨 슬롯 수를 런타임에 읽어옴 | 하드코딩 금지, Spine 파일 변경 시 코드 수정 불필요 |
| 2026-02-20 | Mulberry32 PRNG 계승 | 기존 캐릭터 시스템과 동일한 결정적 생성 보장 |
| 2026-02-20 | 캐릭터를 하단 영역에 제한 | 시야 가림 방지, 작업 방해 최소화 |
| 2026-02-20 | `celebrate` 애니메이션 추가 | 완료 시 폴짝폴짝 뛰는 기쁨 표현 |
