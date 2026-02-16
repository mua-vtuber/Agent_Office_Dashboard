# Character Appearance Implementation Plan

> 기준 설계: `character-appearance-spec.md`
> 기준 코드: `apps/frontend/src/pages/OfficePage.tsx`

---

## 운영 규칙

### 자율 실행 원칙
- 각 Phase가 끝나면 **검증 → git commit → git push** 후 다음 Phase로 진행한다.
- 진행 중 보고나 허가를 받지 않는다. 막히는 경우에만 질문한다.
- 모든 커밋 메시지는 `feat(character):` 또는 `refactor(office):` 접두사를 사용한다.

### 팀 에이전트 병렬화 규칙
- `🤖 병렬 가능` 표시가 있는 작업은 팀 에이전트(Task subagent)를 동시에 실행한다.
- 독립적인 파일 생성/수정은 병렬로, 의존 관계가 있는 작업은 순차로 처리한다.

---

## Phase 0: 코어 모듈 — 타입 + PRNG + 팔레트

### 목표
캐릭터 시스템의 기초 유틸리티를 만든다. 다른 모든 Phase가 이 모듈에 의존한다.

### 작업 목록

#### 0-1. 디렉토리 생성
```
apps/frontend/src/lib/character/
```

#### 0-2. `types.ts` 작성
```typescript
import type { Graphics } from "pixi.js";

/* 캔버스 상수 — 모든 파츠가 공유하는 좌표계 */
export const CHAR_W = 40;
export const CHAR_H = 40;
export const ORIGIN_X = CHAR_W / 2;   // 20
export const ORIGIN_Y = CHAR_H / 2;   // 20

/* 코드 기반 파츠(body, hair) 드로잉 함수 시그니처 */
export type PartDrawFn = (graphics: Graphics, colors: number[]) => void;

/* 시드에서 결정된 캐릭터 외형 속성 */
export interface CharacterTraits {
  bodyIndex: number;
  hairIndex: number;
  costumeIndex: number;
  accessoryIndex: number;   // -1 = 없음
  skinColor: number;        // 0xRRGGBB
  hairColor: number;
  costumeColors: number[];  // [zone1, zone2, zone3, zone4]
  accessoryColors: number[];
}

/* SVG 마커색 규약 */
export const MARKER_COLORS = [
  "#FF0000",  // zone 1
  "#00FF00",  // zone 2
  "#0000FF",  // zone 3
  "#FFFF00",  // zone 4
] as const;
```

#### 0-3. `generator.ts` 작성 — 시드 해시 + Mulberry32 PRNG + 특성 생성

포함할 함수:
- `hashSeed(agentId: string): number` — 기존 `OfficePage.tsx:44`의 해시를 개선한 `Math.imul(31, h)` 버전 사용
- `mulberry32(seed: number): () => number` — 결정적 PRNG
- `generateTraits(agentId: string, partCounts: { body: number; hair: number; costume: number; accessory: number }): CharacterTraits`
  - PRNG 소비 순서: body → hair → costume → accessory → skinColor → hairColor → costumeColors(4) → accessoryColors(4)
  - accessoryIndex: `floor(rand() * (count + 1)) - 1` (−1이면 없음)

#### 0-4. `palette.ts` 작성 — HSL 색상 유틸

포함할 함수:
- `generateHSL(rand: () => number): { h: number; s: number; l: number }` — 채도 40–79, 명도 35–64
- `hslToHex(h: number, s: number, l: number): number` — 0xRRGGBB 반환
- `hslToHexStr(h: number, s: number, l: number): string` — `"#RRGGBB"` 반환
- `generateColorHex(rand: () => number): number` — 내부에서 `generateHSL` → `hslToHex`

### 검증
- `generator.ts`의 `generateTraits`를 동일 ID로 2회 호출 시 동일 결과 확인
- 다른 ID 10종으로 호출 시 bodyIndex/hairColor 등이 충분히 분산되는지 콘솔 확인
- TypeScript 컴파일 에러 없음 (`pnpm --filter frontend tsc --noEmit`)

### 커밋
```
feat(character): add core types, PRNG generator, and palette utilities
```

---

## Phase 1: 코드 기반 파츠 — body + hair

### 목표
최소 2종 body + 3종 hair를 코드(Graphics API)로 작성한다.

### 작업 목록

#### 1-1. `parts/body/0.ts` — 기본 체형 `🤖 병렬 가능`
```
머리: circle(0, -2, 5)
몸통: roundRect(-4, 4, 8, 10, 2)
왼다리: roundRect(-5, 14, 4, 6, 1)
오른다리: roundRect(1, 14, 4, 6, 1)
```
colors[0] = skinColor 전체 적용

#### 1-2. `parts/body/1.ts` — 통통 체형 `🤖 병렬 가능`
```
머리: circle(0, -2, 6)
몸통: roundRect(-5, 4, 10, 11, 3)
왼다리: roundRect(-5, 15, 4, 5, 1)
오른다리: roundRect(1, 15, 4, 5, 1)
```

#### 1-3. `parts/hair/0.ts` — 짧은 머리 `🤖 병렬 가능`
```
ellipse(0, -5, 6, 3) — 윗부분 캡
```

#### 1-4. `parts/hair/1.ts` — 긴 머리 `🤖 병렬 가능`
```
ellipse(0, -5, 6, 3) — 윗부분 캡
rect(-6, -4, 2, 10) — 왼 사이드
rect(4, -4, 2, 10) — 오른 사이드
```

#### 1-5. `parts/hair/2.ts` — 뾰족 머리 `🤖 병렬 가능`
```
moveTo(0, -10).lineTo(-5, -2).lineTo(5, -2).closePath() — 삼각형
```

### 검증
- 각 파츠 파일이 `PartDrawFn` 타입에 부합하는지 tsc 확인
- `import.meta.glob("./parts/body/*.ts")` 결과가 2개인지 확인
- `import.meta.glob("./parts/hair/*.ts")` 결과가 3개인지 확인

### 커밋
```
feat(character): add code-based body (2 types) and hair (3 types) parts
```

---

## Phase 2: SVG 파츠 — costume + accessory

### 목표
최소 2종 costume + 2종 accessory SVG를 만들고, 팔레트 스왑 유틸을 작성한다.

### 작업 목록

#### 2-1. `palette.ts`에 `swapPalette` 함수 추가
```typescript
async function swapPalette(
  svgUrl: string,
  colorMap: Record<string, string>
): Promise<Texture>
```
- SVG 텍스트 fetch → 마커색 문자열 치환 → Blob → `Assets.load` → Texture 반환
- ObjectURL 즉시 revoke

#### 2-2. `parts/costume/0.svg` — 수트 `🤖 병렬 가능`
```
viewBox="0 0 40 40"
zone1(#FF0000): 몸통 직사각 (서류가방 직원 느낌)
zone2(#00FF00): 라펠/칼라
zone3(#0000FF): 넥타이/포인트
```

#### 2-3. `parts/costume/1.svg` — 캐주얼 `🤖 병렬 가능`
```
viewBox="0 0 40 40"
zone1(#FF0000): 상의
zone2(#00FF00): 하의
```

#### 2-4. `parts/accessory/0.svg` — 안경 `🤖 병렬 가능`
```
viewBox="0 0 40 40"
zone1(#FF0000): 프레임 색
고정색(#333333): 다리
```

#### 2-5. `parts/accessory/1.svg` — 모자 `🤖 병렬 가능`
```
viewBox="0 0 40 40"
zone1(#FF0000): 모자 본체
zone2(#00FF00): 챙/리본
```

### 검증
- 각 SVG가 유효한 XML인지 확인
- `viewBox="0 0 40 40"` 포함 확인
- 마커색이 정확히 `#FF0000`, `#00FF00`, `#0000FF` 형식인지 확인
- `swapPalette`에 테스트 컬러맵 전달 시 문자열 치환 결과 확인 (단위 테스트 또는 콘솔)
- tsc 통과

### 커밋
```
feat(character): add SVG costume (2 types), accessory (2 types), and palette swap
```

---

## Phase 3: Builder — 파츠 조립 + 캐시

### 목표
`agent_id`를 입력하면 조립된 PixiJS Container를 반환하는 `buildCharacter` 함수를 완성한다.

### 작업 목록

#### 3-1. `builder.ts` 작성

```typescript
export async function buildCharacter(agentId: string): Promise<Container>
```

내부 흐름:
1. 캐시 확인 → 있으면 즉시 반환
2. `import.meta.glob`으로 파츠 목록 로드
3. `generateTraits(agentId, { body: N, hair: M, costume: K, accessory: L })` 호출
4. Container 생성
5. body Graphics → `addChild` (1층)
6. costume SVG → `swapPalette` → Sprite → `addChild` (2층)
7. hair Graphics → `addChild` (3층)
8. accessory SVG → `swapPalette` → Sprite → `addChild` (4층, 있을 경우)
9. Container 스케일 조정: `AGENT_R * 2 / CHAR_W` (OfficePage 기준 반지름에 맞춤)
10. `pivot` 설정: `(ORIGIN_X, ORIGIN_Y)` → 중앙 기준점
11. 캐시 저장 후 반환

#### 3-2. 캐시 모듈

```typescript
const cache = new Map<string, Container>();

export function getCachedCharacter(agentId: string): Container | undefined;
export function clearCharacterCache(): void;
```

- `clearCharacterCache()`는 Settings에서 호출 가능하도록 export

#### 3-3. 파츠 카운트 자동 탐색

```typescript
// builder.ts 상단
const bodyModules = import.meta.glob("./parts/body/*.ts", { eager: true });
const hairModules = import.meta.glob("./parts/hair/*.ts", { eager: true });
const costumeModules = import.meta.glob("./parts/costume/*.svg", { eager: true, query: "?url", import: "default" });
const accessoryModules = import.meta.glob("./parts/accessory/*.svg", { eager: true, query: "?url", import: "default" });
```

### 검증
- `buildCharacter("test/worker-1")` 호출 시 Container 반환
- 동일 ID 2회 호출 시 캐시 히트 (같은 참조 반환)
- Container.children 수: 3개(body + costume + hair) 또는 4개(+ accessory)
- tsc 통과
- **시각 확인**: 임시로 OfficePage에서 한 에이전트의 원을 buildCharacter 결과로 대체하여 렌더링 확인

### 커밋
```
feat(character): add builder with auto-discovery, assembly, and caching
```

---

## Phase 4: OfficePage 통합

### 목표
`OfficePage.tsx`의 `AgentNode`를 원(circle)에서 캐릭터 Container로 교체한다.

### 작업 목록

#### 4-1. `AgentNode` 타입 수정

변경 전:
```typescript
type AgentNode = {
  root: Container;
  body: Graphics;      // ← 원
  ring: Graphics;
  ...
};
```

변경 후:
```typescript
type AgentNode = {
  root: Container;
  body: Container;     // ← 캐릭터 Container (buildCharacter 결과)
  ring: Graphics;
  statusOverlay: Graphics;  // ← 상태색 반투명 오버레이 (기존 statusColor 대체)
  ...
};
```

#### 4-2. `createNode` 수정

변경 사항:
1. `buildCharacter(agent.agent_id)` 호출 (비동기)
2. 초기 렌더링은 기존 원(fallback)으로, 캐릭터 로딩 완료 시 교체
3. 캐릭터 Container 위에 상태색 반투명 오버레이 추가

```typescript
// 즉시: fallback 원 표시
const fallback = new Graphics();
fallback.circle(0, 0, AGENT_R).fill(statusColor(agent.status));
root.addChild(fallback);

// 비동기: 캐릭터 로딩
buildCharacter(agent.agent_id).then((char) => {
  root.removeChild(fallback);
  fallback.destroy();
  root.addChildAt(char, 0);  // ring 아래에 삽입
  node.body = char;
});
```

#### 4-3. `refreshNode` 수정

변경 사항:
- `body.clear()` + `circle` 다시 그리기 → 제거
- 대신 `statusOverlay` 업데이트 (캐릭터 위 반투명 테두리/글로우)
- 캐릭터 본체는 상태와 무관하게 유지 (외형은 고정)

```typescript
function refreshNode(node: AgentNode, agent: AgentView): void {
  // 상태 오버레이만 갱신 (캐릭터 자체는 불변)
  node.statusOverlay.clear();
  node.statusOverlay.circle(0, 0, AGENT_R + 2)
    .stroke({ color: statusColor(agent.status), width: 2, alpha: 0.7 });

  node.ring.visible = agent.status === "working";
  node.effectText.text = effectLabel(agent.status);
  applyBubble(node.bubble, node.bubbleBg, node.bubbleTxt, agent.status);
  node.status = agent.status;
}
```

#### 4-4. 상태 표현 정책

| 기존 (원) | 변경 후 |
|---|---|
| 원 전체를 상태색으로 채움 | 캐릭터 외형은 고정, **테두리 글로우**로 상태 표현 |
| 색상만으로 상태 구분 | 글로우 색 + 기존 이펙트(!, ..., Zzz) + 말풍선 유지 |

#### 4-5. AGENT_R 활용

- 캐릭터 Container의 스케일: `(AGENT_R * 2) / CHAR_W`
  - AGENT_R=10 → 스케일 0.5 → 캐릭터가 20x20px 공간에 렌더링
- 이펙트/말풍선의 y 오프셋은 기존과 동일하게 `AGENT_R` 기준 유지

### 검증
- 모든 에이전트가 고유 외형으로 렌더링됨
- 동일 agent_id 재접속 시 같은 외형
- 상태 변경 시 글로우 색이 바뀌고 이펙트가 정상 작동
- fallback 원이 캐릭터 로딩 전에 보이고, 로딩 후 교체됨
- 이동 애니메이션(ticker)이 정상 동작
- **FPS 확인**: 20 에이전트 기준 30 FPS 이상 (`app.ticker.FPS` 로깅)
- tsc 통과
- `pnpm --filter frontend build` 성공

### 커밋
```
feat(office): replace circle agents with seed-based character sprites
```

---

## Phase 5: 통합 검증 + 정리

### 목표
전체 동작을 end-to-end로 검증하고 코드를 정리한다.

### 작업 목록

#### 5-1. Mock 시나리오 테스트 `🤖 병렬 가능`
- `pnpm --filter backend seed:mock` 실행
- 5 에이전트가 각각 고유 외형으로 표시되는지 확인
- 상태 전이 시나리오별 시각 확인:
  - working → 글로우 초록 + working paper
  - failed → 글로우 빨강 + `!` + 흔들림
  - resting → 글로우 회색 + `Zzz`
  - meeting → 이동 + 말풍선
  - breakroom → 탕비실 이동

#### 5-2. OfficePage 정리
- 사용하지 않는 `statusColor` 직접 사용 코드 제거 (글로우로 이관된 부분)
- 기존 `hashSeed` 함수가 `generator.ts`와 중복되면 `generator.ts`에서 import로 통합
- 불필요한 코드/주석 제거

#### 5-3. exports 정리 `🤖 병렬 가능`
- `lib/character/index.ts` 배럴 파일 작성
  ```typescript
  export { buildCharacter, clearCharacterCache } from "./builder";
  export type { CharacterTraits, PartDrawFn } from "./types";
  ```

#### 5-4. implementation-plan.md 체크리스트 업데이트
- `[ ] 캐릭터 외형 시스템` 항목 추가 및 체크

### 검증
- `pnpm --filter frontend build` 성공
- `pnpm --filter frontend tsc --noEmit` 성공
- Mock 시나리오 전체 통과

### 커밋
```
refactor(office): clean up legacy circle rendering, add character barrel export
```

---

## 요약: Phase별 의존 관계

```
Phase 0  (코어 모듈)
  │
  ├──→  Phase 1  (코드 파츠: body + hair)  ─── 🤖 5개 파일 병렬 작성
  │
  ├──→  Phase 2  (SVG 파츠 + 팔레트 스왑)  ─── 🤖 4개 SVG 병렬 작성
  │
  │     ↓ (Phase 1 + Phase 2 완료 후)
  │
  └──→  Phase 3  (Builder 조립 + 캐시)
           │
           ↓
        Phase 4  (OfficePage 통합)
           │
           ↓
        Phase 5  (검증 + 정리)
```

> **Phase 1과 Phase 2는 독립적이므로 팀 에이전트로 병렬 실행 가능.**
> Phase 0 완료 후 즉시 두 팀으로 나눠 동시 진행한다.

---

## 파일 변경 매트릭스

| 파일 | Phase | 작업 |
|---|---|---|
| `src/lib/character/types.ts` | 0 | 신규 |
| `src/lib/character/generator.ts` | 0 | 신규 |
| `src/lib/character/palette.ts` | 0, 2 | 신규, 추가 |
| `src/lib/character/parts/body/0.ts` | 1 | 신규 |
| `src/lib/character/parts/body/1.ts` | 1 | 신규 |
| `src/lib/character/parts/hair/0.ts` | 1 | 신규 |
| `src/lib/character/parts/hair/1.ts` | 1 | 신규 |
| `src/lib/character/parts/hair/2.ts` | 1 | 신규 |
| `src/lib/character/parts/costume/0.svg` | 2 | 신규 |
| `src/lib/character/parts/costume/1.svg` | 2 | 신규 |
| `src/lib/character/parts/accessory/0.svg` | 2 | 신규 |
| `src/lib/character/parts/accessory/1.svg` | 2 | 신규 |
| `src/lib/character/builder.ts` | 3 | 신규 |
| `src/lib/character/index.ts` | 5 | 신규 |
| `src/pages/OfficePage.tsx` | 4, 5 | 수정 |
| `docs/implementation-plan.md` | 5 | 수정 |

---

## 리스크 & 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| SVG 로딩 지연으로 첫 렌더링 느림 | UX | Phase 4-2에서 fallback 원 → 캐릭터 전환 구현 |
| 캐릭터가 너무 작아 구분 불가 | UX | AGENT_R을 12~14로 올리거나, hover 시 확대 추가 |
| 파츠 수가 적어 외형이 비슷함 | 다양성 | MVP 후 파츠 추가는 파일만 넣으면 자동 반영 |
| `import.meta.glob` SSR 비호환 | 빌드 | 현재 SPA 전용이므로 영향 없음 |

---

## 결정 로그
- 2026-02-16: 5-Phase 점진적 구현 채택
- 2026-02-16: Phase 1 + Phase 2 병렬 실행 결정
- 2026-02-16: 상태 표현을 원 채우기 → 글로우 테두리로 변경
- 2026-02-16: fallback 원 → 비동기 캐릭터 전환 패턴 채택
