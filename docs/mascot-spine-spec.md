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

외형 프로필에는 스킨 인덱스(형태)와 그라디언트 맵 생성 파라미터(색상)가 포함된다.

```rust
pub struct AppearanceProfile {
    // ── 스킨 선택 (형태) ──
    pub body_index: usize,
    pub hair_index: usize,
    pub outfit_index: usize,
    pub accessory_index: usize,  // 0 = 없음
    pub face_index: usize,

    // ── 그라디언트 맵 생성 파라미터 (색상) ──
    // 피부: 파스텔 제약 (config 범위 내)
    pub skin_hue: f64,           // 0.0 ~ 360.0
    pub skin_saturation: f64,    // config 범위 내 (기본 20~40)
    pub skin_lightness: f64,     // config 범위 내 (기본 80~92)

    // 머리카락: 제한 없음
    pub hair_hue: f64,           // 0.0 ~ 360.0
    pub hair_saturation: f64,    // 20.0 ~ 100.0
    pub hair_lightness: f64,     // 30.0 ~ 90.0

    // 옷: Zone A 기준색 (B/C/D는 배색 규칙으로 자동 생성)
    pub outfit_hue: f64,         // 0.0 ~ 360.0
    pub outfit_saturation: f64,  // 30.0 ~ 100.0
    pub outfit_lightness: f64,   // 30.0 ~ 80.0

    // 반사광: 따뜻함/차가움 경향
    pub spec_hue: f64,           // 0.0 ~ 360.0
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
        accessory_index: rng.next_index(slot_counts.accessory + 1),
        face_index: rng.next_index(slot_counts.face),

        skin_hue: rng.next_f64() * 360.0,
        skin_saturation: config.skin_saturation_min
            + rng.next_f64() * (config.skin_saturation_max - config.skin_saturation_min),
        skin_lightness: config.skin_lightness_min
            + rng.next_f64() * (config.skin_lightness_max - config.skin_lightness_min),

        hair_hue: rng.next_f64() * 360.0,
        hair_saturation: 20.0 + rng.next_f64() * 80.0,
        hair_lightness: 30.0 + rng.next_f64() * 60.0,

        outfit_hue: rng.next_f64() * 360.0,
        outfit_saturation: 30.0 + rng.next_f64() * 70.0,
        outfit_lightness: 30.0 + rng.next_f64() * 50.0,

        spec_hue: rng.next_f64() * 360.0,
    }
}
```

WebView에서 이 파라미터들을 받아 **256×1 그라디언트 맵 텍스처를 절차적으로 생성**하고, 셰이더에 전달한다. 생성 로직 상세는 §4.6~§4.7 참조.

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

## 4. 그라디언트 맵 컬러 시스템

스킨은 **형태(shape)**를 결정하고, **색상**은 런타임에서 **채널 패킹 + 그라디언트 맵 셰이더**로 결정한다.

기존의 단순 슬롯 틴팅(곱셈 블렌딩) 대신, 채널별 마스크 + 그라디언트 맵 룩업 방식을 사용하여 명도 구간별 색조 이동, 반사광, 상태별 특수효과를 구현한다.

### 4.1 왜 그라디언트 맵인가

**단순 틴팅의 한계:**
- 그림자 부분은 그냥 "어두운 같은 색"이 됨
- 피부는 실제로 그림자에서 채도가 올라가고 색조가 이동함
- 옷에 여러 색 영역을 넣을 수 없음 (1슬롯 = 1색)

**그라디언트 맵이 해결하는 것:**
- 밝은 부분과 어두운 부분에 **다른 색조** 적용 가능
- 예: 핑크 피부의 그림자는 살짝 보라빛 → 자연스러움
- 옷 하나에 **여러 색 영역**을 밝기 구간으로 분리 가능
- 상태별 특수효과(발광, 펄스)를 셰이더 하나로 통합

### 4.2 채널 패킹 규약

스파인 텍스처의 RGB 채널을 **색이 아닌 마스크**로 사용한다.

```
텍스처의 각 픽셀:
  R = 본채색 마스크     (이 픽셀에 어떤 밝기의 기본 색을 입힐지)
  G = 반사광 마스크     (이 픽셀에 얼마나 반사광을 줄지)
  B = 특수효과 마스크   (이 픽셀에 얼마나 이펙트 효과를 줄지)
  A = 투명도           (일반적인 알파, 변경 없음)
```

**쉽게 말하면:** RGB 채널 각각을 흑백 그림으로 칠하는 것이다. 실제 색은 셰이더가 그라디언트 맵에서 찾아 입힌다.

### 4.3 슬롯 타입별 채널 해석

같은 셰이더를 사용하되, uniform 값(`mode`)으로 채널 해석을 구분한다.

#### 모드 0: 피부 / 머리카락

```
R채널: 본채색 마스크 → "본채색 그라디언트" 참조
G채널: 반사광 마스크 → "반사광 그라디언트" 참조
B채널: 특수효과 강도 → 이펙트 색상 × 강도
```

- R채널을 0~255 **풀 범위**로 명암 페인팅
- 그라디언트 맵 하나가 전체 색을 결정
- 예: R값 200인 픽셀 → 그라디언트의 200번째 색 → 밝은 핑크
- 예: R값 50인 픽셀 → 그라디언트의 50번째 색 → 어두운 보라

#### 모드 1: 옷 (4존 시스템)

```
R채널: 4개 존으로 나뉜 본채색 마스크 (아래 §4.4 참조)
G채널: 반사광 마스크 → "반사광 그라디언트" 참조
B채널: 특수효과 강도 → 이펙트 색상 × 강도
```

### 4.4 옷 4존 시스템

옷은 여러 색 영역이 필요하므로, R채널의 **밝기 범위를 4등분**하여 각 존을 다른 색으로 칠한다.

```
R채널 밝기값 범위:

  0 ──── 63      Zone A: 주 원단 (재킷 본체, 스커트 등)
  64 ─── 127     Zone B: 보조색 (칼라, 커프스, 포켓 등)
  128 ── 191     Zone C: 포인트 (넥타이, 벨트, 리본 등)
  192 ── 255     Zone D: 디테일 (버튼, 스티치, 자수, 라인 등)
```

각 존 내에서 밝기 차이(0~63)가 **그 존 색상의 명암**이 된다:
- 존 A 안에서 값 0 → 재킷의 가장 어두운 부분 (그림자)
- 존 A 안에서 값 63 → 재킷의 가장 밝은 부분 (하이라이트)

**존당 64단계**는 사람 눈이 구분하는 밝기 단계(약 50~60)를 충분히 커버한다.

#### 그라디언트 맵 텍스처 구성 (옷용, 256×1)

```
픽셀 위치:
 [0─────63]  [64────127]  [128───191]  [192───255]
  Zone A       Zone B       Zone C       Zone D
  어둠→밝음    어둠→밝음    어둠→밝음    어둠→밝음

예시 (네이비 정장):
  남색→하늘   금색→크림    빨강→분홍    회색→흰색
  (재킷)      (포켓칩)     (넥타이)     (버튼/스티치)
```

### 4.5 채널별 자세한 설명

#### R채널: 본채색 마스크

> **역할:** "이 픽셀에 어떤 색을 입힐지"를 결정하는 마스크

**피부/머리 모드에서:** 0(어두움) ~ 255(밝음) 전체를 자유롭게 사용. 일반적인 흑백 명암 페인팅과 동일하다.

**옷 모드에서:** 4개 존의 밝기 범위 안에서 페인팅. 존이 바뀌면 셰이더가 다른 색으로 칠한다.

```
피부 R채널 예시:              옷 R채널 예시:

  ┌──────────────┐             ┌──────────────┐
  │  ████████    │  밝은 부분   │ ▓▓▓▓ 재킷 ▓▓ │  Zone A (0~63)
  │  ██████████  │  (R=200)    │ ████ 칼라 ███ │  Zone B (64~127)
  │  ████████    │             │ ░░ 넥타이 ░░░ │  Zone C (128~191)
  │  ██░░░░██    │  그림자     │ ·· 버튼 ····· │  Zone D (192~255)
  │  ██░░░░██    │  (R=50)     │              │
  └──────────────┘             └──────────────┘
    R: 0~255 풀범위              R: 존별 구간 사용
```

#### G채널: 반사광 마스크

> **역할:** "이 픽셀에 얼마나 반사광(하이라이트)을 줄지"를 결정하는 마스크

- 흰색(255)에 가까울수록 반사광이 강하게 들어감
- 검은색(0)이면 반사광 없음
- 주로 윤곽, 모서리, 표면이 빛을 받는 부분에 밝게 칠함

```
  반사광 마스크 (G채널):

  ┌──────────────┐
  │    ░░        │  ← 머리카락 윤곽 하이라이트
  │  ░░    ░░    │  ← 이마, 볼 하이라이트
  │              │
  │    ░░        │  ← 옷 주름 하이라이트
  │              │  (대부분 검정 = 반사광 없음)
  └──────────────┘
```

반사광 색상은 별도 그라디언트 맵으로 결정된다:
- 따뜻한 반사광 (살구색) → 생동감
- 차가운 반사광 (하늘색) → 판타지 느낌
- 반사광 그라디언트도 랜덤 생성 가능

#### B채널: 특수효과 마스크

> **역할:** "이 픽셀에 상태별 이펙트를 얼마나 줄지"를 결정하는 마스크

- 에이전트 상태에 따라 **셰이더가 런타임에** 이펙트 색과 강도를 조절
- B채널 마스크 자체는 "어디에 이펙트가 보이는가"를 정의 (정적)
- 이펙트 색과 강도는 코드에서 상태별로 바꿈 (동적)

```
  특수효과 마스크 (B채널):

  ┌──────────────┐
  │    ████      │  ← 머리/얼굴 주변 (생각 이펙트)
  │  ██████████  │
  │    ████      │
  │              │  ← 몸통 (약한 이펙트 또는 없음)
  │              │
  └──────────────┘
```

**상태별 이펙트 연출:**

| 에이전트 상태 | B채널 사용 | 이펙트 색 | 강도 |
|-------------|-----------|----------|------|
| `idle` | 미사용 | - | 0 |
| `working` | 은은한 발광 | 따뜻한 노랑 | 0.1~0.2 |
| `thinking` | 부드러운 반짝임 | 하늘색 | 0.2~0.3 |
| `failed` | 붉은 펄스 | 빨강 | 0.3~0.5 (시간에 따라 변동) |
| `completed` | 축하 반짝임 | 금색 | 0.4 |
| `resting` | 없음 | - | 0 |
| `startled` | 번쩍 | 흰색 | 0.8 (순간) |

### 4.6 그라디언트 맵 텍스처 상세

그라디언트 맵은 **256×1 픽셀 이미지**이다. 셰이더가 마스크의 밝기값을 이 이미지의 X좌표로 사용하여 색을 가져온다.

```
마스크 밝기값 50 → 그라디언트 맵의 50번째 픽셀 색상을 가져와서 칠함
마스크 밝기값 200 → 그라디언트 맵의 200번째 픽셀 색상을 가져와서 칠함
```

#### 피부/머리 그라디언트 (풀 범위)

```
 0                           128                          255
 ├────────────────────────────┼────────────────────────────┤
 진한 보라  →  연한 보라  →  핑크  →  밝은 핑크  →  거의 흰색

 (그림자)                    (중간)                    (하이라이트)
```

포인트: 그림자(왼쪽)에서 하이라이트(오른쪽)로 갈 때 **색조가 자연스럽게 이동**한다.
단순 틴팅은 "어두운 핑크 → 밝은 핑크"만 가능하지만, 그라디언트 맵은 "진한 보라 → 핑크"처럼 색조 자체가 변할 수 있다. 이것이 퀄리티 차이.

#### 옷 그라디언트 (4존)

```
  Zone A          Zone B          Zone C          Zone D
 0      63      64     127     128     191     192     255
 ├───────┤      ├───────┤      ├───────┤      ├───────┤
 어둠→밝음      어둠→밝음      어둠→밝음      어둠→밝음
 (주 원단)      (보조색)       (포인트)       (디테일)
```

각 존은 독립된 미니 그라디언트이다. 존마다 다른 색상 계열이 들어간다.

### 4.7 파스텔 피부색 생성 규칙

피부의 본채색 그라디언트는 **파스텔 제약** 안에서 랜덤 생성한다:

```
기본 색조 (Hue): 0~360 랜덤 (어떤 색이든 가능)
채도 (Saturation): 20~40% (채도를 낮게 → 자동 파스텔)
명도 (Lightness): 80~92% (밝게)

예시:
  Hue=270 (보라), S=30%, L=85%  →  연보라
  Hue=200 (파랑), S=25%, L=88%  →  하늘색
  Hue=120 (초록), S=30%, L=85%  →  민트
  Hue=0   (빨강), S=35%, L=87%  →  살구색
  Hue=40  (주황), S=25%, L=90%  →  크림색
```

이 기본 HSL에서 그라디언트를 자동 생성한다:
- 그림자 쪽: 채도 +15%, 명도 -20%, 색조 +10~20° 이동
- 하이라이트 쪽: 채도 -10%, 명도 +5%

```toml
[appearance]
skin_saturation_min = 20.0
skin_saturation_max = 40.0
skin_lightness_min = 80.0
skin_lightness_max = 92.0
```

머리카락과 옷은 채도/명도 제한 없이 자유롭게 생성한다.

### 4.8 실제 작업 플로우 (아티스트 가이드)

#### Step 1: 평소처럼 흑백으로 그린다

각 파츠를 **레이어 분리**하여 0~255 풀 범위의 흑백으로 명암 페인팅한다.

```
레이어 구성 예시 (옷):
  ├─ 재킷_명암     ← 흑백, 풀 범위 (0~255)
  ├─ 칼라_명암     ← 흑백, 풀 범위 (0~255)
  ├─ 넥타이_명암   ← 흑백, 풀 범위 (0~255)
  └─ 버튼_명암     ← 흑백, 풀 범위 (0~255)
```

이 단계는 지금까지 해온 것과 **완전히 동일**하다. 그냥 흑백 명암을 그리면 된다.

#### Step 2: 밝기 범위를 존별로 압축한다 (옷만 해당)

Photoshop/CSP의 **Levels(레벨)** 또는 **Curves(커브)**에서 Output 범위를 조절한다.

```
Photoshop Levels 창:
  Input:  0 ─────────── 255  (건드리지 않음)
  Output: [변경] ──── [변경]

각 레이어별 Output 설정:
  재킷 레이어:    Output  0 ~ 63     → Zone A
  칼라 레이어:    Output 64 ~ 127    → Zone B
  넥타이 레이어:  Output 128 ~ 191   → Zone C
  버튼 레이어:    Output 192 ~ 255   → Zone D
```

**이 작업이 하는 일:** 원래 0~255 범위의 명암을 좁은 구간으로 압축한다. 그림 자체는 안 바뀌고, 밝기 범위만 바뀐다.

예를 들어 재킷 레이어에 Output 0~63을 적용하면:
- 원래 검은색(0) → 그대로 0
- 원래 흰색(255) → 63으로 바뀜
- 중간 회색(128) → 약 32로 바뀜

#### Step 3: 레이어를 합쳐서 R채널에 넣는다

```
1. 존별 범위 조절이 끝난 레이어들을 전부 Flatten (병합)
2. 병합된 결과를 R채널에 넣는다

   Photoshop: 채널 패널 → R채널 선택 → 붙여넣기
   CSP: 레이어 속성에서 채널별 출력 조절
```

#### Step 4: G채널에 반사광 마스크를 그린다

- 새 레이어에서 반사광이 들어갈 위치를 밝게 칠한다
- 주로 윤곽선, 머리카락 결, 옷 주름의 꼭대기, 이마/코 하이라이트
- 결과를 G채널에 넣는다

#### Step 5: B채널에 특수효과 마스크를 그린다

- 런타임 이펙트가 나타날 영역을 밝게 칠한다
- 보통 캐릭터 실루엣을 따라 부드럽게, 또는 특정 부위(얼굴 주변, 손 등)에 집중
- 결과를 B채널에 넣는다

#### Step 6: A채널 (투명도)

- 기존과 동일하게 투명도를 설정한다
- 변경 사항 없음

#### 최종 결과

```
R채널: 존별로 범위가 나뉜 명암 마스크 (흑백)
G채널: 반사광 위치 마스크 (흑백)
B채널: 특수효과 영역 마스크 (흑백)
A채널: 투명도 (기존 방식)
```

**스파인 에디터에서 보면** 이 텍스처는 이상한 색으로 보인다 (RGB가 각각 다른 마스크이므로). **정상이다.** 실제 색은 런타임 셰이더가 그라디언트 맵을 참조하여 입힌다.

### 4.9 피부/머리 vs 옷: 작업 차이 요약

| | 피부 / 머리카락 | 옷 |
|---|---|---|
| R채널 | 0~255 풀 범위 자유롭게 | 4존으로 나눠서 (각 64단계) |
| 레벨 조절 | 필요 없음 | 존별 Output 범위 압축 |
| G채널 | 동일 (반사광 마스크) | 동일 |
| B채널 | 동일 (이펙트 마스크) | 동일 |
| 셰이더 모드 | mode=0 (단일 그라디언트) | mode=1 (4존 그라디언트) |

### 4.10 배색 조화 (옷 4존 자동 생성)

옷의 4존 색상을 완전 랜덤으로 하면 촌스러울 수 있으므로, 배색 규칙을 적용한다:

```
1. Zone A (주 원단) 색상을 먼저 랜덤 결정
2. 나머지 존은 A와의 관계로 자동 결정:

   Zone B = A의 유사색 (Hue ± 30°)
   Zone C = A의 보색 (Hue + 180°) 또는 삼각 배색 (Hue + 120°)
   Zone D = 무채색 계열 (채도 10% 이하)
```

이 규칙은 config에서 조절 가능하도록 설계한다.

### 4.11 셰이더 동작 요약

아래는 개념 이해를 위한 간소화된 셰이더이다 (실제 구현은 PixiJS v8 Filter API 기반):

```glsl
// 입력
uniform sampler2D uTexture;        // 스파인 슬롯 텍스처 (채널 패킹됨)
uniform sampler2D uGradBase;       // R채널용 그라디언트 맵 (256×1)
uniform sampler2D uGradSpec;       // G채널용 반사광 그라디언트 (256×1)
uniform vec4 uEffectColor;         // B채널용 이펙트 색상 (상태별 동적)
uniform float uEffectIntensity;    // B채널 이펙트 강도 (상태별 동적)

void main() {
    vec4 tex = texture(uTexture, vUV);

    // R채널 → 본채색 (그라디언트 맵에서 색 가져오기)
    vec3 baseColor = texture(uGradBase, vec2(tex.r, 0.0)).rgb;

    // G채널 → 반사광 (반사광 그라디언트에서 색 가져오기)
    vec3 specColor = texture(uGradSpec, vec2(tex.g, 0.0)).rgb;

    // B채널 → 특수효과 (이펙트 색상 × 마스크 강도)
    vec3 effectColor = uEffectColor.rgb * tex.b * uEffectIntensity;

    // 합성
    vec3 finalColor = baseColor + specColor + effectColor;

    gl_FragColor = vec4(finalColor, tex.a);
}
```

합성 방식(`+`)은 프로토타입 후 screen blend, overlay 등으로 실험하여 결정한다.

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
- [ ] **채널 패킹 텍스처 제작** (아래 체크리스트 참조)
- [ ] JSON export (Binary 아님)

#### 채널 패킹 제작 체크리스트

- [ ] 모든 슬롯 텍스처가 채널 패킹 방식으로 제작됨 (RGB = 마스크, 색 아님)
- [ ] R채널: 피부/머리 → 0~255 풀 범위 명암 / 옷 → 4존 범위 구분
- [ ] G채널: 반사광 위치 마스크 페인팅
- [ ] B채널: 특수효과 영역 마스크 페인팅
- [ ] A채널: 투명도 (기존 방식)
- [ ] 옷 텍스처의 존 경계가 명확 (64 단위 범위 안에서 페인팅)
- [ ] 스파인 에디터에서 텍스처가 이상한 색으로 보이는 것은 정상 (셰이더 적용 전)

### 8.3 주의사항

- 스킨 이름은 정확한 규약을 따라야 함 — 런타임에서 prefix 매칭으로 자동 탐색
- **텍스처는 흑백 마스크를 RGB 채널에 넣은 것이다.** 스파인 에디터에서 미리보기 시 실제 색이 아닌 채널 마스크 조합색이 보인다. 런타임 셰이더 적용 후 의도한 색이 나온다.
- 캐릭터 크기: 활동 영역 높이(config)에 맞게 스케일 조절됨
- 옷 존 경계에서 안티앨리어싱 주의: 존 A(63)와 존 B(64)의 경계 픽셀이 중간값(63.5)이 되면 셰이더가 잘못된 색을 참조할 수 있음. 존 경계는 **하드 엣지**로 처리하거나, 경계 부분에 1~2px 여유를 두는 것을 권장

## 9. 결정 로그

| 날짜 | 결정 | 이유 |
|------|------|------|
| 2026-02-20 | SVG 레이어 → Spine 2D 전환 | 사용자가 Spine 작업 가능, 프로 품질 애니메이션 |
| 2026-02-20 | 스킨 슬롯 수를 런타임에 읽어옴 | 하드코딩 금지, Spine 파일 변경 시 코드 수정 불필요 |
| 2026-02-20 | Mulberry32 PRNG 계승 | 기존 캐릭터 시스템과 동일한 결정적 생성 보장 |
| 2026-02-20 | 캐릭터를 하단 영역에 제한 | 시야 가림 방지, 작업 방해 최소화 |
| 2026-02-20 | `celebrate` 애니메이션 추가 | 완료 시 폴짝폴짝 뛰는 기쁨 표현 |
| 2026-02-20 | 슬롯 틴팅 → 그라디언트 맵 컬러 시스템 전환 | 명도별 색조 이동으로 퀄리티 향상, 포트폴리오 가치, 상태별 특수효과 통합 |
| 2026-02-20 | 채널 패킹 (R:본채색, G:반사광, B:특수효과) | 셰이더 하나로 3가지 색상 계층 통합 처리 |
| 2026-02-20 | 옷 4존 시스템 (존당 64단계) | 하나의 R채널로 최대 4색 영역 지원, 존당 64단계는 인지 가능한 명암 표현에 충분 |
| 2026-02-20 | B채널을 에이전트 상태별 이펙트에 활용 | 기술적 연출과 에이전트 상태의 연동 — 연구작 포트폴리오 포인트 |
| 2026-02-20 | 합성 방식은 프로토타입 후 결정 | 단순 더하기, screen blend, overlay 등 실험 필요 |
