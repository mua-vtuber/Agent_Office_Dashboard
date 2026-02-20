# Character Appearance Specification

## 1. 목적
에이전트를 단순 원(circle)이 아닌, 시드 기반으로 자동 생성되는 고유 외형을 가진 캐릭터로 표현한다.
동일 `agent_id`는 항상 같은 외형을 생성하고, 다른 `agent_id`는 높은 확률로 서로 다른 외형을 생성한다.

## 2. 설계 원칙
- **결정적 생성**: `agent_id` 문자열을 시드로 사용하여, 같은 ID는 항상 같은 외형을 생성한다.
- **파일 기반 확장**: 각 파츠 폴더에 번호 파일을 추가하면 코드 수정 없이 조합에 반영된다.
- **하이브리드 렌더링**: 단순 파츠(body, hair)는 코드(PixiJS Graphics), 복잡한 파츠(costume, accessory)는 SVG + 팔레트 스왑으로 처리한다.
- **캔버스 통일**: 모든 파츠가 동일한 좌표계(viewBox)를 공유하여 정확히 겹칠 수 있다.

## 3. 시드 기반 외형 결정

### 3.1 시드 생성
`agent_id` 문자열을 해시하여 32비트 정수 시드를 만든다.

```typescript
function hashSeed(agentId: string): number {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) {
    h = (Math.imul(31, h) + agentId.charCodeAt(i)) | 0;
  }
  return h >>> 0; // unsigned 32-bit
}
```

### 3.2 시드 소비
시드에서 결정적 난수 시퀀스를 생성하여 각 속성을 순서대로 결정한다.

```
seed → PRNG
  ├─ next() → body 인덱스
  ├─ next() → hair 인덱스
  ├─ next() → costume 인덱스
  ├─ next() → accessory 인덱스 (없음 포함)
  ├─ next() → 피부색 HSL
  ├─ next() → 머리색 HSL
  ├─ next() → 의상 zone1 색 HSL
  ├─ next() → 의상 zone2 색 HSL
  └─ ...
```

PRNG 알고리즘은 Mulberry32를 사용한다:

```typescript
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

## 4. 파츠 구조

### 4.1 디렉토리 구조

```
apps/frontend/src/lib/character/
  types.ts              ← 타입 정의, 캔버스 상수
  generator.ts          ← 시드 → 외형 속성 결정
  builder.ts            ← 파츠 로드 + Container 조립
  palette.ts            ← HSL 색상 생성, 팔레트 스왑 유틸
  parts/
    body/               ← 코드 기반 (PartDrawFn)
      0.ts
      1.ts
    hair/               ← 코드 기반 (PartDrawFn)
      0.ts
      1.ts
      2.ts
    costume/            ← SVG 기반 (팔레트 스왑)
      0.svg
      1.svg
    accessory/          ← SVG 기반 (팔레트 스왑), 선택적
      0.svg
      1.svg
```

### 4.2 파츠 유형

| 파츠 | 렌더링 방식 | 이유 |
|---|---|---|
| body | 코드 (Graphics API) | 단순 형태, 좌표 소수로 표현 가능 |
| hair | 코드 (Graphics API) | 단순 형태, 코드 추가 용이 |
| costume | SVG + 팔레트 스왑 | 복잡한 형태, 도트 에디터/벡터 에디터로 제작 |
| accessory | SVG + 팔레트 스왑 | 복잡한 형태, 크기가 본체를 초과할 수 있음 |

### 4.3 코드 기반 파츠 인터페이스

```typescript
// types.ts
export const CANVAS_W = 40;
export const CANVAS_H = 40;
export const ORIGIN_X = CANVAS_W / 2;  // 20 — 중앙 기준점
export const ORIGIN_Y = CANVAS_H / 2;  // 20

export type PartDrawFn = (
  graphics: Graphics,
  colors: number[]
) => void;
```

코드 파츠 파일 예시:

```typescript
// parts/body/0.ts — 기본 체형
import type { PartDrawFn } from "../../types";

const draw: PartDrawFn = (g, colors) => {
  g.circle(0, -2, 5).fill(colors[0]);         // 머리
  g.roundRect(-4, 4, 8, 10, 2).fill(colors[0]); // 몸통
  g.roundRect(-5, 14, 4, 6, 1).fill(colors[0]); // 왼다리
  g.roundRect(1, 14, 4, 6, 1).fill(colors[0]);  // 오른다리
};

export default draw;
```

### 4.4 SVG 기반 파츠

SVG 파일은 동일한 viewBox를 사용하며, 마커색으로 zone을 구분한다.

```xml
<!-- parts/costume/0.svg — 수트 -->
<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <!-- zone 1: 몸통 -->
  <path d="M15,22 L14,34 L26,34 L25,22 Z" fill="#FF0000"/>
  <!-- zone 2: 라펠 -->
  <path d="M16,22 L20,28 L24,22 Z" fill="#00FF00"/>
  <!-- zone 3: 넥타이 -->
  <path d="M19,24 L20,32 L21,24 Z" fill="#0000FF"/>
</svg>
```

## 5. 팔레트 스왑 (SVG 색상 교체)

### 5.1 마커색 규약

SVG 내에서 다음 색상을 "교체 대상 zone"으로 약속한다:

| 마커색 | 용도 |
|---|---|
| `#FF0000` | zone 1 — 주요색 |
| `#00FF00` | zone 2 — 보조색 |
| `#0000FF` | zone 3 — 포인트색 |
| `#FFFF00` | zone 4 — 추가색 (선택) |

의상/악세사리마다 사용하는 zone 수는 달라도 무방하다.
마커색이 존재하면 교체하고, 없으면 무시한다.

### 5.2 색상 생성

시드에서 HSL 기반으로 색상을 생성한다:

```typescript
function generateColor(rand: () => number): { h: number; s: number; l: number } {
  return {
    h: Math.floor(rand() * 360),       // 0–359
    s: 40 + Math.floor(rand() * 40),    // 40–79% (채도 적당)
    l: 35 + Math.floor(rand() * 30),    // 35–64% (너무 어둡거나 밝지 않게)
  };
}
```

한 색에서 명암 변형을 자동 생성하여 입체감을 부여할 수 있다:

```typescript
const highlight = hslToHex(h, s, Math.min(l + 15, 90));
const shadow    = hslToHex(h, s, Math.max(l - 15, 10));
```

### 5.3 스왑 프로세스

```typescript
async function swapPalette(
  svgUrl: string,
  colorMap: Record<string, string>
): Promise<Texture> {
  let svg = await fetch(svgUrl).then(r => r.text());

  for (const [marker, replacement] of Object.entries(colorMap)) {
    svg = svg.replaceAll(marker, replacement);
  }

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const objectUrl = URL.createObjectURL(blob);
  const texture = await Assets.load(objectUrl);
  URL.revokeObjectURL(objectUrl);

  return texture;
}
```

**비트맵과 달리 SVG는 반투명 경계 픽셀이 없으므로**, 문자열 치환만으로 아티팩트 없이 완전한 팔레트 교체가 가능하다.

## 6. 파츠 자동 탐색

Vite의 `import.meta.glob`을 사용하여 폴더 내 파일을 자동으로 탐색한다.
파일 추가/삭제 시 코드 수정이 필요 없다.

### 6.1 코드 파츠 (body, hair)

```typescript
const bodyModules = import.meta.glob("./parts/body/*.ts", { eager: true });
const bodyParts: PartDrawFn[] = Object.values(bodyModules)
  .map((m: any) => m.default)
  .filter(Boolean);

// 사용
const bodyIndex = Math.floor(rand() * bodyParts.length);
bodyParts[bodyIndex](graphics, colors);
```

### 6.2 SVG 파츠 (costume, accessory)

```typescript
const costumeModules = import.meta.glob("./parts/costume/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
const costumePaths: string[] = Object.values(costumeModules) as string[];

// 사용
const costumeIndex = Math.floor(rand() * costumePaths.length);
const texture = await swapPalette(costumePaths[costumeIndex], colorMap);
```

## 7. 캔버스 및 레이어링

### 7.1 캔버스 크기

모든 파츠는 **40 x 40** 좌표계를 공유한다.
캐릭터 본체는 중앙(20, 20) 기준으로 그려지며, 악세사리는 이 영역을 초과할 수 있다.

```
         ← 40 →
    ┌──────────────────┐ ↑
    │                  │ │
    │   악세사리 영역   │ │
    │  ┌────────────┐  │ │
    │  │  캐릭터     │  │ 40
    │  │  본체 영역  │  │ │
    │  └────────────┘  │ │
    │                  │ │
    └──────────────────┘ ↓
```

SVG 파일은 `viewBox="0 0 40 40"`을 사용한다.
코드 파츠는 `(ORIGIN_X, ORIGIN_Y)` = `(20, 20)`을 원점으로 그린다.
PixiJS Graphics는 그려진 영역만 렌더링하므로 빈 공간에 대한 성능 비용은 없다.

### 7.2 레이어 순서

파츠를 PixiJS Container에 아래부터 위로 쌓는다:

```
4층  accessory   ← 최상단 (모자, 날개 등)
3층  hair        ← 머리카락
2층  costume     ← 의상
1층  body        ← 몸 (최하단)
```

```typescript
const container = new Container();
container.addChild(bodyGraphics);      // 1층
container.addChild(costumeSprite);     // 2층
container.addChild(hairGraphics);      // 3층
container.addChild(accessorySprite);   // 4층
```

SVG 채우기는 불투명(opacity 1.0)이므로 상위 레이어가 하위를 깨끗하게 가린다.

## 8. 조립 흐름

```
agent_id
  │
  ▼
hashSeed(agent_id) → seed
  │
  ▼
mulberry32(seed) → rand()
  │
  ├─ bodyIndex   = floor(rand() * bodyParts.length)
  ├─ hairIndex   = floor(rand() * hairParts.length)
  ├─ costumeIndex = floor(rand() * costumePaths.length)
  ├─ accessoryIndex = floor(rand() * (accessoryPaths.length + 1))
  │                   (0이면 악세사리 없음)
  ├─ skinColor   = generateColor(rand)
  ├─ hairColor   = generateColor(rand)
  ├─ costumeColors = [generateColor(rand), generateColor(rand), ...]
  └─ accessoryColors = [generateColor(rand), ...]
  │
  ▼
Container 조립
  ├─ body:      Graphics API로 그리기 (skinColor)
  ├─ costume:   SVG 로드 → 팔레트 스왑 (costumeColors) → Sprite
  ├─ hair:      Graphics API로 그리기 (hairColor)
  └─ accessory: SVG 로드 → 팔레트 스왑 (accessoryColors) → Sprite (선택)
  │
  ▼
캐시에 저장 (agent_id → Container)
  → 같은 agent_id 재요청 시 캐시 반환
```

## 9. SVG 파츠 제작 가이드

### 9.1 작업 도구
Figma(무료), Inkscape(무료), 또는 기타 벡터 에디터를 사용한다.

### 9.2 제작 순서
1. 캔버스를 40 x 40으로 설정한다.
2. 캐릭터 본체 가이드라인을 배경에 깔아둔다 (내보내기에 포함하지 않는다).
3. 의상/악세사리를 가이드라인 위에 그린다.
4. 색상 교체가 필요한 영역에 마커색(`#FF0000`, `#00FF00`, `#0000FF`, `#FFFF00`)을 칠한다.
5. 교체 대상이 아닌 고정색(검정 외곽선 등)은 마커색이 아닌 다른 색을 사용한다.
6. SVG로 내보낸다 (viewBox가 `0 0 40 40`인지 확인).
7. `parts/costume/` 또는 `parts/accessory/` 폴더에 다음 번호로 저장한다.

### 9.3 주의사항
- 불투명도는 반드시 100%로 설정한다 (반투명 사용 금지).
- 마커색 4가지(`#FF0000`, `#00FF00`, `#0000FF`, `#FFFF00`)는 고정색으로 사용하지 않는다.
- SVG 내에 래스터 이미지(`<image>`)를 포함하지 않는다.
- 그라데이션(`<linearGradient>`, `<radialGradient>`)에는 마커색을 사용하지 않는다 (단색 fill만 마커색 대상).

## 10. 캐시 전략
- `agent_id` → 조립된 Container를 `Map<string, Container>`에 캐시한다.
- 캐시 무효화 조건:
  - 파츠 파일이 변경된 경우 (개발 시 HMR로 자동 처리).
  - Settings에서 외형 리셋이 요청된 경우.
- 동시 20 에이전트 기준, 캐시 크기는 무시할 수 있는 수준이다.

## 11. 기존 코드와의 통합
- 현재 `OfficePage.tsx`의 `AgentNode`는 원(circle) + 상태색으로 에이전트를 표현한다.
- 이 설계를 적용하면 `AgentNode` 내부의 원을 캐릭터 Container로 교체한다.
- `shared-schema`의 `avatar_id` 필드는 외형 오버라이드 용도로 예약한다 (MVP에서는 `agent_id` 기반 자동 생성만 사용).
- 상태별 이펙트(working paper, failed scream, resting zzz)는 캐릭터 Container 위에 별도 레이어로 유지한다.

## 12. 결정 로그
- 2026-02-16: 시드 기반 결정적 캐릭터 생성 방식 채택
- 2026-02-16: 하이브리드 렌더링 채택 — body/hair는 코드, costume/accessory는 SVG
- 2026-02-16: SVG 팔레트 스왑 방식 채택 — 비트맵 대비 반투명 아티팩트 없음
- 2026-02-16: 파일 번호 기반 + `import.meta.glob` 자동 탐색 채택
- 2026-02-16: 캔버스 크기 40x40, 악세사리 초과 영역 허용
