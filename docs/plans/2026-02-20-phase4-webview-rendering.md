# Phase 4: WebView Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Spine 캐릭터를 화면 하단에 렌더링하고, 상태별 애니메이션 전환 + 대화 이동 + React UI 오버레이를 구현하여 Rust 백엔드와 end-to-end로 연동한다.

**Architecture:** PixiJS v8 Application을 투명 WebView 위에 마운트하고, spine-pixi로 캐릭터를 렌더링한다. Zustand agent-store 변경을 구독하여 CharacterManager가 캐릭터 생성/삭제/상태전환/이동을 처리한다. React 오버레이(ErrorToast, ResumeModal)는 PixiJS 캔버스 위에 absolute positioning으로 배치한다.

**Tech Stack:** PixiJS v8, @esotericsoftware/spine-pixi 4.2, React 19, TypeScript strict, Zustand v5

**그라디언트 맵 셰이더:** 이 Phase에서는 구현하지 않는다. Spine 슬롯 틴팅(곱셈 블렌딩)으로 placeholder 색상을 적용한다. 채널 패킹 텍스처 + 셰이더는 실제 아트가 준비된 후 별도 Phase에서 구현.

---

## 사전 준비: Placeholder Spine 에셋

코드 구현 전에 사용자가 Spine 에디터에서 준비해야 할 것:

### 요구사항

```
파일명: character.json / character.atlas / character.png
Export 형식: JSON (Binary 아님)
```

**필수 스킨 (네이밍 규약 준수):**
- `body/type-0` — 아무 이미지 하나 (80×120px 정도의 사각형/실루엣)
- `hair/style-0` — 빈 스킨이거나 간단한 이미지
- `outfit/style-0` — 빈 스킨이거나 간단한 이미지
- `face/type-0` — 빈 스킨이거나 간단한 이미지

**필수 애니메이션 (11개):**

| 이름 | 타입 | 길이 | 간단한 동작이면 OK |
|------|------|------|-------------------|
| `appear` | one-shot | 0.5초 | scale 0→1 |
| `idle` | loop | 3초 | 미세 상하 움직임 |
| `working` | loop | 2초 | 빠른 상하 움직임 |
| `thinking` | loop | 2.5초 | 좌우 기울기 |
| `failed` | one-shot | 1초 | 흔들림 |
| `celebrate` | one-shot | 1.5초 | 점프 |
| `resting` | loop | 4초 | 천천히 내려앉기 |
| `startled` | one-shot | 0.5초 | 빠른 점프 |
| `walking` | loop | 0.6초 | 좌우 기울며 이동 |
| `chatting` | loop | 2초 | 고개 끄덕 |
| `disappear` | one-shot | 0.5초 | scale 1→0 |

**완료 후:** `character.json`, `character.atlas`, `character.png` 파일을 `apps/webview/public/spine/` 디렉토리에 배치. (public에 넣어야 Vite가 static serving)

---

## Task 1: PixiJS + spine-pixi 의존성 설치 및 프로젝트 설정

**Files:**
- Modify: `apps/webview/package.json`
- Modify: `apps/webview/vite.config.ts`
- Create: `apps/webview/public/spine/.gitkeep`

**Context:**
- 현재 WebView는 React + Zustand + i18next만 설치됨
- PixiJS v8과 spine-pixi 4.2를 추가해야 함
- Vite에서 `.atlas` 파일을 static asset으로 처리하도록 설정 필요

**Step 1: 의존성 설치**

```bash
cd apps/webview
pnpm add pixi.js@^8.0.0 @esotericsoftware/spine-pixi@^4.2.0
```

**Step 2: Vite 설정 업데이트**

`apps/webview/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: true,
    port: 1420,
    strictPort: true,
  },
  assetsInclude: ["**/*.atlas"],
});
```

**Step 3: Spine 에셋 디렉토리 준비**

```bash
mkdir -p apps/webview/public/spine
touch apps/webview/public/spine/.gitkeep
```

**Step 4: 빌드 확인**

```bash
cd apps/webview
pnpm run build
```

Expected: 빌드 성공, 에러 없음.

**Step 5: Commit**

```bash
git add apps/webview/package.json apps/webview/pnpm-lock.yaml apps/webview/vite.config.ts apps/webview/public/spine/.gitkeep
git commit -m "feat(phase4): add pixi.js v8 and spine-pixi dependencies"
```

---

## Task 2: 렌더링 상수 + 유틸리티 타입 정의

**Files:**
- Create: `apps/webview/src/pixi/constants.ts`
- Modify: `apps/webview/src/tauri/commands.ts` (notifyChatDone 추가)

**Context:**
- 상태→애니메이션 매핑, 루프 여부, mix 시간, z-index 상수가 전체 pixi 모듈에서 공유됨
- `commands.ts`에 `notifyChatDone`이 빠져 있음 (Rust에는 구현됨)
- 상수 파일에 하드코딩하는 것은 OK — 이것들은 Spine 애니메이션 이름과 PixiJS 렌더링 상수이므로 config.toml에 넣을 성격이 아님

**Step 1: 상수 파일 작성**

`apps/webview/src/pixi/constants.ts`:
```typescript
import type { AgentStatus } from '../types/agent';

/** AgentStatus → Spine 애니메이션 이름 매핑 */
export const STATUS_TO_ANIMATION: Record<AgentStatus, string> = {
  offline: '',
  appearing: 'appear',
  idle: 'idle',
  working: 'working',
  thinking: 'thinking',
  pending_input: 'thinking',
  failed: 'failed',
  completed: 'celebrate',
  resting: 'resting',
  startled: 'startled',
  walking: 'walking',
  chatting: 'chatting',
  returning: 'walking',
  disappearing: 'disappear',
};

/** 루프 재생하는 애니메이션 */
export const LOOPING_ANIMATIONS = new Set([
  'idle', 'working', 'thinking', 'resting', 'chatting', 'walking',
]);

/** 애니메이션 간 mix(블렌딩) 시간 (초). 키: "from/to" */
export const ANIMATION_MIX_TIMES: Record<string, number> = {
  'idle/working': 0.2,
  'working/idle': 0.2,
  'idle/thinking': 0.3,
  'thinking/working': 0.2,
  'working/failed': 0.1,
  'idle/resting': 0.5,
  'resting/startled': 0,
  'startled/working': 0.2,
  'startled/idle': 0.2,
  'idle/walking': 0.2,
  'walking/chatting': 0.2,
  'chatting/walking': 0.2,
  'walking/idle': 0.2,
};

/** 기본 mix 시간 (매핑에 없는 조합용) */
export const DEFAULT_MIX_TIME = 0.2;

/** Z-index 상수 */
export const Z_INDEX = {
  BEHIND: 0,
  NORMAL: 10,
  BUBBLE: 20,
  LABEL: 25,
} as const;

/** one-shot 애니메이션 완료 후 Rust에 보고해야 하는 synthetic 이벤트 */
export const SYNTHETIC_ANIMATION_EVENTS: Partial<Record<string, string>> = {
  appear: 'appear',
  disappear: 'disappear',
  celebrate: 'celebrate',
  startled: 'startled',
};

/** 상태별 말풍선 표시 여부 */
export const STATUS_BUBBLE_VISIBILITY: Record<AgentStatus, boolean> = {
  offline: false,
  appearing: false,
  idle: false,
  working: true,
  thinking: true,
  pending_input: true,
  failed: true,
  completed: true,
  resting: true,
  startled: true,
  walking: false,
  chatting: true,
  returning: false,
  disappearing: false,
};
```

**Step 2: commands.ts에 notifyChatDone 추가**

`apps/webview/src/tauri/commands.ts`에 추가:
```typescript
export function notifyChatDone(agentId: string): Promise<void> {
  return safeInvoke<void>('notify_chat_done', { agentId });
}
```

**Step 3: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

Expected: 에러 없음.

**Step 4: Commit**

```bash
git add apps/webview/src/pixi/constants.ts apps/webview/src/tauri/commands.ts
git commit -m "feat(phase4): add rendering constants and animation mappings"
```

---

## Task 3: MascotStage — PixiJS 캔버스 마운트

**Files:**
- Create: `apps/webview/src/pixi/MascotStage.ts`

**Context:**
- PixiJS v8 Application을 투명 배경으로 생성
- React ref에 canvas를 마운트
- window resize 이벤트 시 Application.renderer.resize() 호출
- 활동 영역(activity zone)은 화면 하단에 위치 — DisplayConfig의 값 사용

**참고 문서:**
- `docs/mascot-architecture.md` §9 — MascotStage 설명
- `docs/mascot-spine-spec.md` §6.1 — 활동 영역 정의
- `docs/mascot-product-spec.md` §4.1 — 화면 하단에만 캐릭터 존재

**Step 1: MascotStage 클래스 작성**

`apps/webview/src/pixi/MascotStage.ts`:
```typescript
import { Application } from 'pixi.js';
import type { DisplayConfig } from '../types/ipc';

export class MascotStage {
  readonly app: Application;
  private displayConfig: DisplayConfig | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor() {
    this.app = new Application();
  }

  /**
   * PixiJS Application 초기화 + canvas를 컨테이너에 마운트.
   * 반드시 mount 전에 init을 호출해야 한다.
   */
  async init(container: HTMLElement, displayConfig: DisplayConfig): Promise<void> {
    this.displayConfig = displayConfig;

    await this.app.init({
      background: 0x000000,
      backgroundAlpha: 0,
      resizeTo: window,
      antialias: true,
      resolution: window.devicePixelRatio,
      autoDensity: true,
    });

    container.appendChild(this.app.canvas as HTMLCanvasElement);

    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);
  }

  /** 활동 영역의 Y좌표 (캐릭터 발 위치) */
  get groundY(): number {
    if (!this.displayConfig) return window.innerHeight;
    return window.innerHeight - this.displayConfig.taskbar_offset_px;
  }

  /** 활동 영역 높이 */
  get activityZoneHeight(): number {
    return this.displayConfig?.activity_zone_height_px ?? 120;
  }

  updateDisplayConfig(config: DisplayConfig): void {
    this.displayConfig = config;
  }

  private onResize(): void {
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
  }

  destroy(): void {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    this.app.destroy(true);
  }
}
```

**Step 2: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

Expected: 에러 없음.

**Step 3: Commit**

```bash
git add apps/webview/src/pixi/MascotStage.ts
git commit -m "feat(phase4): add MascotStage with transparent PixiJS canvas"
```

---

## Task 4: SpineCharacter — 스켈레톤 로드 + 스킨 + 애니메이션

**Files:**
- Create: `apps/webview/src/pixi/SpineCharacter.ts`

**Context:**
- spine-pixi의 `Spine` 클래스로 캐릭터 인스턴스 생성
- `AppearanceProfile`의 인덱스로 스킨 합성 (customSkin.addSkin)
- `AgentStatus` 변경 시 애니메이션 전환 (transitionTo)
- one-shot 애니메이션 완료 시 Rust에 synthetic event 전달 (notifyAnimationDone)
- 색상은 이 Phase에서는 간단한 slot tinting만 적용 (gradient map은 미래 Phase)

**참고 문서:**
- `docs/mascot-spine-spec.md` §2.3 — 스킨 조합 규칙
- `docs/mascot-spine-spec.md` §5 — 애니메이션 목록 + mix 시간
- `docs/mascot-state-machine.md` §8 — 상태→애니메이션 매핑
- `docs/mascot-ipc-protocol.md` §3.1 — notify_animation_done 명령

**Step 1: SpineCharacter 클래스 작성**

`apps/webview/src/pixi/SpineCharacter.ts`:
```typescript
import { Spine, type SkeletonData } from '@esotericsoftware/spine-pixi';
import { Skin } from '@esotericsoftware/spine-core';
import { Container } from 'pixi.js';
import type { AgentStatus, AppearanceProfile } from '../types/agent';
import { notifyAnimationDone } from '../tauri/commands';
import {
  STATUS_TO_ANIMATION,
  LOOPING_ANIMATIONS,
  ANIMATION_MIX_TIMES,
  DEFAULT_MIX_TIME,
  SYNTHETIC_ANIMATION_EVENTS,
  Z_INDEX,
} from './constants';

export class SpineCharacter {
  readonly container: Container;
  readonly spine: Spine;
  readonly agentId: string;

  private currentAnimation = '';
  private _homeX = 0;
  private _isMoving = false;

  constructor(skeletonData: SkeletonData, agentId: string, appearance: AppearanceProfile) {
    this.agentId = agentId;
    this.container = new Container();
    this.container.sortableChildren = true;
    this.container.zIndex = Z_INDEX.NORMAL;

    // Spine 인스턴스 생성
    this.spine = new Spine(skeletonData);
    this.container.addChild(this.spine);

    // mix 시간 설정
    this.setupMixTimes();

    // 스킨 적용
    this.applySkin(appearance);

    // 간단 틴팅 (placeholder)
    this.applySimpleTint(appearance);

    // one-shot 애니메이션 완료 리스너
    this.spine.state.addListener({
      complete: (entry) => {
        const animName = entry.animation?.name;
        if (!animName) return;

        // synthetic event가 필요한 애니메이션인지 확인
        const syntheticType = SYNTHETIC_ANIMATION_EVENTS[animName];
        if (syntheticType) {
          notifyAnimationDone(this.agentId, syntheticType).catch((e) => {
            console.error(`[SpineCharacter] notifyAnimationDone failed:`, e);
          });
        }

        // celebrate 완료 후 idle로 자동 전환
        if (animName === 'celebrate') {
          this.playAnimation('idle');
        }
      },
    });
  }

  get homeX(): number {
    return this._homeX;
  }

  set homeX(x: number) {
    this._homeX = x;
    if (!this._isMoving) {
      this.container.x = x;
    }
  }

  get isMoving(): boolean {
    return this._isMoving;
  }

  set isMoving(v: boolean) {
    this._isMoving = v;
  }

  /** 상태 전환 → 대응하는 애니메이션 재생 */
  transitionTo(status: AgentStatus): void {
    const animName = STATUS_TO_ANIMATION[status];
    if (!animName || animName === this.currentAnimation) return;
    this.playAnimation(animName);
  }

  /** facing 방향 설정 (1 = 오른쪽, -1 = 왼쪽) */
  setFacing(direction: 1 | -1): void {
    this.spine.scale.x = Math.abs(this.spine.scale.x) * direction;
  }

  private playAnimation(name: string): void {
    const loop = LOOPING_ANIMATIONS.has(name);
    this.spine.state.setAnimation(0, name, loop);
    this.currentAnimation = name;
  }

  private setupMixTimes(): void {
    const stateData = this.spine.skeleton.data.findAnimation('idle')
      ? this.spine.state.data
      : null;
    if (!stateData) return;

    for (const [key, time] of Object.entries(ANIMATION_MIX_TIMES)) {
      const [from, to] = key.split('/');
      const fromAnim = this.spine.skeleton.data.findAnimation(from);
      const toAnim = this.spine.skeleton.data.findAnimation(to);
      if (fromAnim && toAnim) {
        stateData.setMix(fromAnim, toAnim, time);
      }
    }
    stateData.defaultMix = DEFAULT_MIX_TIME;
  }

  /** AppearanceProfile의 인덱스로 복합 스킨 생성 */
  private applySkin(appearance: AppearanceProfile): void {
    const data = this.spine.skeleton.data;
    const customSkin = new Skin('agent-custom');

    const tryAdd = (name: string) => {
      const skin = data.findSkin(name);
      if (skin) customSkin.addSkin(skin);
    };

    tryAdd(`body/type-${appearance.body_index}`);
    tryAdd(`hair/style-${appearance.hair_index}`);
    tryAdd(`outfit/style-${appearance.outfit_index}`);
    if (appearance.accessory_index > 0) {
      tryAdd(`accessory/item-${appearance.accessory_index}`);
    }
    tryAdd(`face/type-${appearance.face_index}`);

    this.spine.skeleton.setSkin(customSkin);
    this.spine.skeleton.setSlotsToSetupPose();
  }

  /** Placeholder: HSL → 간단한 슬롯 틴팅 (gradient map은 미래 Phase) */
  private applySimpleTint(_appearance: AppearanceProfile): void {
    // Phase 4에서는 틴팅 미적용 — placeholder 그대로 표시
    // Phase 5 (gradient map shader)에서 이 메서드를 교체
  }

  destroy(): void {
    this.container.removeFromParent();
    this.spine.destroy();
    this.container.destroy({ children: true });
  }
}
```

**Step 2: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

Expected: 에러 없음. (`@esotericsoftware/spine-pixi`와 `@esotericsoftware/spine-core` 타입이 함께 설치됨)

참고: spine-pixi가 spine-core를 peer dependency로 가지고 있을 수 있다. 타입 에러 시:
```bash
pnpm add @esotericsoftware/spine-core@^4.2.0
```

**Step 3: Commit**

```bash
git add apps/webview/src/pixi/SpineCharacter.ts
git commit -m "feat(phase4): add SpineCharacter with skin composition and animation transitions"
```

---

## Task 5: SpeechBubble — 말풍선 렌더링

**Files:**
- Create: `apps/webview/src/pixi/SpeechBubble.ts`

**Context:**
- 캐릭터 위에 떠 있는 말풍선
- 상태에 따라 다른 텍스트 표시 (§9 상태별 말풍선 테이블 참조)
- `max_bubble_chars`로 텍스트 자르기
- `bubble_fade_ms` 후 자동 숨김 (completed, startled 등 일시 표시)
- PixiJS Graphics (배경) + Text (텍스트)로 구현

**참고 문서:**
- `docs/mascot-state-machine.md` §9 — 상태별 말풍선 내용
- `docs/mascot-ipc-protocol.md` — DisplayConfig.max_bubble_chars, bubble_fade_ms

**Step 1: SpeechBubble 클래스 작성**

`apps/webview/src/pixi/SpeechBubble.ts`:
```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Z_INDEX } from './constants';

const BUBBLE_PADDING_X = 10;
const BUBBLE_PADDING_Y = 6;
const BUBBLE_RADIUS = 8;
const BUBBLE_TAIL_SIZE = 6;
const BUBBLE_MAX_WIDTH = 200;
const BUBBLE_OFFSET_Y = -20;

const TEXT_STYLE = new TextStyle({
  fontFamily: 'sans-serif',
  fontSize: 12,
  fill: 0x333333,
  wordWrap: true,
  wordWrapWidth: BUBBLE_MAX_WIDTH - BUBBLE_PADDING_X * 2,
  lineHeight: 16,
});

export class SpeechBubble {
  readonly container: Container;
  private bg: Graphics;
  private label: Text;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private maxChars = 80;

  constructor() {
    this.container = new Container();
    this.container.zIndex = Z_INDEX.BUBBLE;
    this.container.visible = false;

    this.bg = new Graphics();
    this.label = new Text({ text: '', style: TEXT_STYLE });

    this.container.addChild(this.bg, this.label);
  }

  setMaxChars(max: number): void {
    this.maxChars = max;
  }

  /**
   * 말풍선 표시.
   * @param text 표시할 텍스트
   * @param fadeMs 자동 숨김까지 밀리초. 0이면 수동 hide까지 유지.
   */
  show(text: string, fadeMs = 0): void {
    this.clearFadeTimer();

    const truncated = text.length > this.maxChars
      ? text.slice(0, this.maxChars) + '...'
      : text;

    this.label.text = truncated;

    // 배경 그리기
    const textWidth = Math.min(this.label.width, BUBBLE_MAX_WIDTH);
    const textHeight = this.label.height;
    const bgWidth = textWidth + BUBBLE_PADDING_X * 2;
    const bgHeight = textHeight + BUBBLE_PADDING_Y * 2;

    this.bg.clear();
    this.bg.roundRect(0, 0, bgWidth, bgHeight, BUBBLE_RADIUS);
    this.bg.fill({ color: 0xffffff, alpha: 0.92 });
    this.bg.moveTo(bgWidth / 2 - BUBBLE_TAIL_SIZE, bgHeight);
    this.bg.lineTo(bgWidth / 2, bgHeight + BUBBLE_TAIL_SIZE);
    this.bg.lineTo(bgWidth / 2 + BUBBLE_TAIL_SIZE, bgHeight);
    this.bg.closePath();
    this.bg.fill({ color: 0xffffff, alpha: 0.92 });

    // 텍스트 위치
    this.label.x = BUBBLE_PADDING_X;
    this.label.y = BUBBLE_PADDING_Y;

    // 컨테이너 중앙 정렬 + 위로 오프셋
    this.container.x = -bgWidth / 2;
    this.container.y = BUBBLE_OFFSET_Y - bgHeight - BUBBLE_TAIL_SIZE;

    this.container.visible = true;

    if (fadeMs > 0) {
      this.fadeTimer = setTimeout(() => this.hide(), fadeMs);
    }
  }

  hide(): void {
    this.clearFadeTimer();
    this.container.visible = false;
  }

  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  destroy(): void {
    this.clearFadeTimer();
    this.container.removeFromParent();
    this.container.destroy({ children: true });
  }
}
```

**Step 2: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/webview/src/pixi/SpeechBubble.ts
git commit -m "feat(phase4): add SpeechBubble with text truncation and auto-fade"
```

---

## Task 6: WorkspaceLabel — 프로젝트 이름 라벨

**Files:**
- Create: `apps/webview/src/pixi/WorkspaceLabel.ts`

**Context:**
- 워크스페이스 그룹 위에 표시되는 프로젝트 이름 라벨
- 게임의 길드명 느낌
- 그룹 중앙에 정렬
- PixiJS Text로 구현

**참고 문서:**
- `docs/mascot-architecture.md` §3.2 — WorkspaceLabel 모듈
- `docs/mascot-spine-spec.md` §6.2 — 워크스페이스 그룹 배치

**Step 1: WorkspaceLabel 클래스 작성**

`apps/webview/src/pixi/WorkspaceLabel.ts`:
```typescript
import { Container, Text, TextStyle, Graphics } from 'pixi.js';
import { Z_INDEX } from './constants';

const LABEL_STYLE = new TextStyle({
  fontFamily: 'sans-serif',
  fontSize: 11,
  fill: 0xcccccc,
  fontWeight: 'bold',
  letterSpacing: 0.5,
});

const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 3;
const LABEL_RADIUS = 4;
const LABEL_OFFSET_Y = -12;

export class WorkspaceLabel {
  readonly container: Container;
  private bg: Graphics;
  private label: Text;

  constructor(workspaceId: string) {
    this.container = new Container();
    this.container.zIndex = Z_INDEX.LABEL;

    this.bg = new Graphics();
    this.label = new Text({ text: workspaceId, style: LABEL_STYLE });

    this.container.addChild(this.bg, this.label);
    this.redraw();
  }

  /** 그룹 너비에 맞춰 중앙 정렬 */
  updatePosition(groupCenterX: number, topY: number): void {
    const totalWidth = this.label.width + LABEL_PADDING_X * 2;
    this.container.x = groupCenterX - totalWidth / 2;
    this.container.y = topY + LABEL_OFFSET_Y;
  }

  private redraw(): void {
    const w = this.label.width + LABEL_PADDING_X * 2;
    const h = this.label.height + LABEL_PADDING_Y * 2;

    this.bg.clear();
    this.bg.roundRect(0, 0, w, h, LABEL_RADIUS);
    this.bg.fill({ color: 0x000000, alpha: 0.4 });

    this.label.x = LABEL_PADDING_X;
    this.label.y = LABEL_PADDING_Y;
  }

  destroy(): void {
    this.container.removeFromParent();
    this.container.destroy({ children: true });
  }
}
```

**Step 2: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/webview/src/pixi/WorkspaceLabel.ts
git commit -m "feat(phase4): add WorkspaceLabel for workspace group names"
```

---

## Task 7: CharacterManager — 캐릭터 생명주기 + 배치

**Files:**
- Create: `apps/webview/src/pixi/CharacterManager.ts`

**Context:**
- Spine 스켈레톤 로드 (한 번만) → 이후 인스턴스 재활용
- 에이전트 등장(agent-appeared) → SpineCharacter 생성 → MascotStage에 추가
- 에이전트 업데이트(agent-update) → SpineCharacter.transitionTo() + SpeechBubble 업데이트
- 에이전트 퇴장(agent-departed) → SpineCharacter 파괴
- 워크스페이스별 그룹핑 + 위치 계산 (character_spacing, group_spacing from DisplayConfig)
- SlotCounts 추출 → Rust에 전달

**참고 문서:**
- `docs/mascot-architecture.md` §3.2 — CharacterManager 책임
- `docs/mascot-spine-spec.md` §6.2 — 워크스페이스 그룹 배치
- `docs/mascot-spine-spec.md` §7.2 — Spine 에셋 로드 흐름
- `docs/mascot-ipc-protocol.md` §5 — 초기화 시퀀스 (step 8~13)

**Step 1: CharacterManager 클래스 작성**

`apps/webview/src/pixi/CharacterManager.ts`:
```typescript
import { Assets } from 'pixi.js';
import type { SkeletonData } from '@esotericsoftware/spine-pixi';
import type { MascotAgent, AgentStatus, AppearanceProfile } from '../types/agent';
import type { AgentUpdatePayload } from '../types/ipc';
import type { DisplayConfig } from '../types/ipc';
import { setSlotCounts, notifyMovementDone, notifyChatDone } from '../tauri/commands';
import { STATUS_BUBBLE_VISIBILITY } from './constants';
import type { MascotStage } from './MascotStage';
import { SpineCharacter } from './SpineCharacter';
import { SpeechBubble } from './SpeechBubble';
import { WorkspaceLabel } from './WorkspaceLabel';

const SPINE_ASSET_PATH = '/spine/character.json';

interface ManagedCharacter {
  spine: SpineCharacter;
  bubble: SpeechBubble;
  workspaceId: string;
}

interface WorkspaceGroup {
  label: WorkspaceLabel;
  agentIds: string[];
}

export class CharacterManager {
  private stage: MascotStage;
  private displayConfig: DisplayConfig;
  private skeletonData: SkeletonData | null = null;

  private characters = new Map<string, ManagedCharacter>();
  private workspaceGroups = new Map<string, WorkspaceGroup>();

  constructor(stage: MascotStage, displayConfig: DisplayConfig) {
    this.stage = stage;
    this.displayConfig = displayConfig;
  }

  /** Spine 에셋 로드 + SlotCounts 추출 → Rust 전달 */
  async loadSpineAsset(): Promise<void> {
    this.skeletonData = await Assets.load<SkeletonData>(SPINE_ASSET_PATH);

    // SlotCounts 추출
    const counts = { body: 0, hair: 0, outfit: 0, accessory: 0, face: 0 };
    for (const skin of this.skeletonData.skins) {
      if (skin.name.startsWith('body/type-')) counts.body++;
      else if (skin.name.startsWith('hair/style-')) counts.hair++;
      else if (skin.name.startsWith('outfit/style-')) counts.outfit++;
      else if (skin.name.startsWith('accessory/item-')) counts.accessory++;
      else if (skin.name.startsWith('face/type-')) counts.face++;
    }

    await setSlotCounts(counts);
  }

  /** 에이전트 등장 처리 */
  addAgent(agent: MascotAgent): void {
    if (!this.skeletonData) {
      console.error('[CharacterManager] skeletonData not loaded');
      return;
    }
    if (this.characters.has(agent.agent_id)) return;

    // SpineCharacter 생성
    const spine = new SpineCharacter(this.skeletonData, agent.agent_id, agent.appearance);

    // SpeechBubble 생성
    const bubble = new SpeechBubble();
    bubble.setMaxChars(this.displayConfig.max_bubble_chars);
    spine.container.addChild(bubble.container);

    // 워크스페이스 그룹 관리
    let group = this.workspaceGroups.get(agent.workspace_id);
    if (!group) {
      const label = new WorkspaceLabel(agent.workspace_id);
      this.stage.app.stage.addChild(label.container);
      group = { label, agentIds: [] };
      this.workspaceGroups.set(agent.workspace_id, group);
    }
    group.agentIds.push(agent.agent_id);

    // 등록
    this.characters.set(agent.agent_id, {
      spine,
      bubble,
      workspaceId: agent.workspace_id,
    });

    // 스테이지에 추가
    this.stage.app.stage.addChild(spine.container);

    // 위치 재계산
    this.recalculatePositions();

    // 초기 상태 애니메이션
    spine.transitionTo(agent.status);

    // 초기 말풍선
    this.updateBubbleForStatus(agent.agent_id, agent.status, agent.current_task, agent.thinking_text, null);
  }

  /** 에이전트 상태 업데이트 */
  updateAgent(payload: AgentUpdatePayload): void {
    const managed = this.characters.get(payload.agent_id);
    if (!managed) return;

    // 애니메이션 전환
    managed.spine.transitionTo(payload.status);

    // 말풍선 업데이트
    this.updateBubbleForStatus(
      payload.agent_id,
      payload.status,
      payload.current_task,
      payload.thinking_text,
      payload.chat_message,
    );

    // walking 시작 → 이동 시스템 (Task 8에서 구현)
    if (payload.status === 'walking' && payload.peer_agent_id) {
      this.startWalking(payload.agent_id, payload.peer_agent_id);
    }

    // returning 시작 → 복귀 이동 (Task 8에서 구현)
    if (payload.status === 'returning') {
      this.startReturning(payload.agent_id);
    }
  }

  /** 에이전트 퇴장 (disappearing 애니메이션 완료 후 호출) */
  removeAgent(agentId: string): void {
    const managed = this.characters.get(agentId);
    if (!managed) return;

    // 워크스페이스 그룹에서 제거
    const group = this.workspaceGroups.get(managed.workspaceId);
    if (group) {
      group.agentIds = group.agentIds.filter((id) => id !== agentId);
      if (group.agentIds.length === 0) {
        group.label.destroy();
        this.workspaceGroups.delete(managed.workspaceId);
      }
    }

    // 파괴
    managed.bubble.destroy();
    managed.spine.destroy();
    this.characters.delete(agentId);

    // 위치 재계산
    this.recalculatePositions();
  }

  /** 워크스페이스별 위치 재계산 */
  private recalculatePositions(): void {
    const groundY = this.stage.groundY;
    const charSpacing = this.displayConfig.character_spacing_px;
    const groupSpacing = this.displayConfig.group_spacing_px;

    let currentX = groupSpacing / 2; // 왼쪽 여백

    for (const [, group] of this.workspaceGroups) {
      const groupStartX = currentX;
      const groupAgentCount = group.agentIds.length;

      for (let i = 0; i < groupAgentCount; i++) {
        const agentId = group.agentIds[i];
        const managed = this.characters.get(agentId);
        if (!managed) continue;

        const x = currentX + i * charSpacing;
        managed.spine.homeX = x;
        managed.spine.container.y = groundY;
      }

      const groupWidth = Math.max(0, (groupAgentCount - 1) * charSpacing);
      const groupCenterX = groupStartX + groupWidth / 2;

      // 라벨 위치
      group.label.updatePosition(
        groupCenterX,
        groundY - this.stage.activityZoneHeight,
      );

      currentX += groupWidth + groupSpacing;
    }
  }

  /** 상태별 말풍선 업데이트 */
  private updateBubbleForStatus(
    agentId: string,
    status: AgentStatus,
    task: string | null,
    thinking: string | null,
    chatMessage: string | null,
  ): void {
    const managed = this.characters.get(agentId);
    if (!managed) return;

    const shouldShow = STATUS_BUBBLE_VISIBILITY[status];
    if (!shouldShow) {
      managed.bubble.hide();
      return;
    }

    const fadeDuration = this.displayConfig.bubble_fade_ms;

    switch (status) {
      case 'working':
        managed.bubble.show(task ?? '...', 0);
        break;
      case 'thinking':
        managed.bubble.show(thinking ?? '...', 0);
        break;
      case 'pending_input':
        managed.bubble.show('입력 대기중...', 0);
        break;
      case 'failed':
        managed.bubble.show('실패', 0);
        break;
      case 'completed':
        managed.bubble.show('완료!', fadeDuration);
        break;
      case 'resting':
        managed.bubble.show('💤', 0);
        break;
      case 'startled':
        managed.bubble.show('❗', fadeDuration);
        break;
      case 'chatting':
        managed.bubble.show(chatMessage ?? '...', 0);
        break;
      default:
        managed.bubble.hide();
    }
  }

  // ── 이동 시스템 (Task 8에서 구현) ──

  /** walking 시작: 상대에게 이동 */
  startWalking(agentId: string, peerAgentId: string): void {
    // Task 8에서 구현
    void agentId;
    void peerAgentId;
  }

  /** returning 시작: 자기 자리로 복귀 */
  startReturning(agentId: string): void {
    // Task 8에서 구현
    void agentId;
  }

  updateDisplayConfig(config: DisplayConfig): void {
    this.displayConfig = config;
    this.recalculatePositions();
    for (const [, managed] of this.characters) {
      managed.bubble.setMaxChars(config.max_bubble_chars);
    }
  }

  destroy(): void {
    for (const [, managed] of this.characters) {
      managed.bubble.destroy();
      managed.spine.destroy();
    }
    this.characters.clear();

    for (const [, group] of this.workspaceGroups) {
      group.label.destroy();
    }
    this.workspaceGroups.clear();
  }
}
```

**Step 2: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/webview/src/pixi/CharacterManager.ts
git commit -m "feat(phase4): add CharacterManager with workspace grouping and positioning"
```

---

## Task 8: 이동 시스템 — walking / returning / z-order

**Files:**
- Modify: `apps/webview/src/pixi/CharacterManager.ts` (startWalking, startReturning 구현)

**Context:**
- 에이전트가 대화를 위해 다른 에이전트에게 다가감 (walking)
- 다가갈 때 다른 캐릭터 **뒤로** 지나감 (z-index 낮춤, scale 축소)
- 상대 위치에 도착하면 `arrive_at_peer` synthetic event → Rust
- 대화 후 자기 자리로 복귀 (returning)
- 자기 자리 도착하면 `arrive_at_home` synthetic event → Rust
- 이동 속도: config `walk_speed_px_per_sec`
- 도착 판정: config `arrival_distance_px`
- 뒤로 지나갈 때 scale: config `behind_scale`
- PixiJS Ticker로 매 프레임 이동 처리

**참고 문서:**
- `docs/mascot-state-machine.md` §10 — 이동 시스템 전체
- `docs/mascot-spine-spec.md` §6 — 캐릭터 배치 + 워크스페이스
- `src-tauri/config.toml` [movement] 섹션

**주의:** config.toml의 movement 값은 현재 Rust에만 있다. WebView에서 사용하려면 DisplayConfig를 확장하거나 별도 명령을 추가해야 한다. 이 Task에서는 **Rust의 get_display_config 응답에 movement 값 추가** + **WebView 타입 확장** + **이동 로직 구현** 을 함께 한다.

**Step 1: DisplayConfig 타입에 movement 필드 추가**

`apps/webview/src/types/ipc.ts`의 `DisplayConfig`에 추가:
```typescript
export interface DisplayConfig {
  max_bubble_chars: number;
  bubble_fade_ms: number;
  character_spacing_px: number;
  group_spacing_px: number;
  activity_zone_height_px: number;
  taskbar_offset_px: number;
  idle_sway_px: number;
  // movement (Task 8 추가)
  walk_speed_px_per_sec: number;
  arrival_distance_px: number;
  behind_scale: number;
}
```

**Step 2: Rust get_display_config에 movement 필드 추가**

`src-tauri/src/commands/agents.rs`의 `get_display_config` 응답에 movement config 필드 추가:
```rust
// DisplayConfigResponse에 필드 추가
pub walk_speed_px_per_sec: f64,
pub arrival_distance_px: f64,
pub behind_scale: f64,
```

그리고 `get_display_config` 함수에서 `config.movement.*` 값을 매핑.

**Step 3: CharacterManager 이동 로직 구현**

`apps/webview/src/pixi/CharacterManager.ts`의 `startWalking`과 `startReturning`을 실제 구현으로 교체:

```typescript
// 클래스 멤버 추가
private movingAgents = new Map<string, { targetX: number; peerAgentId?: string; type: 'walk' | 'return' }>();

startWalking(agentId: string, peerAgentId: string): void {
  const managed = this.characters.get(agentId);
  const peer = this.characters.get(peerAgentId);
  if (!managed || !peer) return;

  const targetX = peer.spine.homeX;
  const direction = targetX > managed.spine.container.x ? 1 : -1;

  // z-index 낮추고 scale 축소 (뒤로 지나가기)
  managed.spine.container.zIndex = Z_INDEX.BEHIND;
  managed.spine.container.scale.set(this.displayConfig.behind_scale);
  managed.spine.setFacing(direction as 1 | -1);
  managed.spine.isMoving = true;

  this.movingAgents.set(agentId, { targetX, peerAgentId, type: 'walk' });

  // ticker가 없으면 등록
  if (this.movingAgents.size === 1) {
    this.stage.app.ticker.add(this.tickMovement, this);
  }
}

startReturning(agentId: string): void {
  const managed = this.characters.get(agentId);
  if (!managed) return;

  const targetX = managed.spine.homeX;
  const direction = targetX > managed.spine.container.x ? 1 : -1;

  managed.spine.container.zIndex = Z_INDEX.BEHIND;
  managed.spine.container.scale.set(this.displayConfig.behind_scale);
  managed.spine.setFacing(direction as 1 | -1);
  managed.spine.isMoving = true;

  this.movingAgents.set(agentId, { targetX, type: 'return' });

  if (this.movingAgents.size === 1) {
    this.stage.app.ticker.add(this.tickMovement, this);
  }
}

private tickMovement(): void {
  const speed = this.displayConfig.walk_speed_px_per_sec;
  const arrivalDist = this.displayConfig.arrival_distance_px;
  const dt = this.stage.app.ticker.deltaMS / 1000;
  const arrived: string[] = [];

  for (const [agentId, move] of this.movingAgents) {
    const managed = this.characters.get(agentId);
    if (!managed) {
      arrived.push(agentId);
      continue;
    }

    const currentX = managed.spine.container.x;
    const diff = move.targetX - currentX;
    const dist = Math.abs(diff);

    if (dist <= arrivalDist) {
      // 도착
      managed.spine.container.x = move.targetX;
      managed.spine.container.zIndex = Z_INDEX.NORMAL;
      managed.spine.container.scale.set(1);
      managed.spine.isMoving = false;
      arrived.push(agentId);

      if (move.type === 'walk') {
        notifyMovementDone(agentId, 'arrive_at_peer').catch(console.error);
      } else {
        notifyMovementDone(agentId, 'arrive_at_home').catch(console.error);
      }
    } else {
      // 이동
      const step = Math.sign(diff) * Math.min(speed * dt, dist);
      managed.spine.container.x = currentX + step;
    }
  }

  for (const id of arrived) {
    this.movingAgents.delete(id);
  }

  if (this.movingAgents.size === 0) {
    this.stage.app.ticker.remove(this.tickMovement, this);
  }
}
```

**Step 4: import 추가 확인**

CharacterManager.ts 상단에 `Z_INDEX` import와 `notifyMovementDone` import가 있는지 확인. 이미 Task 7에서 import했으므로 `Z_INDEX` 추가만 하면 됨:

```typescript
import { Z_INDEX } from './constants';
```

**Step 5: 타입 체크 + Rust 빌드**

```bash
cd apps/webview && npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml
```

**Step 6: Commit**

```bash
git add apps/webview/src/pixi/CharacterManager.ts apps/webview/src/types/ipc.ts src-tauri/src/commands/agents.rs
git commit -m "feat(phase4): implement character movement system with z-order and facing"
```

---

## Task 9: ErrorToast + ErrorOverlay — React 에러 UI

**Files:**
- Create: `apps/webview/src/components/ErrorToast.tsx`
- Create: `apps/webview/src/components/ErrorOverlay.tsx`

**Context:**
- ErrorToast: 비치명적 에러 (ingest 실패, IPC 에러 등). 화면 우하단, 자동 사라짐
- ErrorOverlay: 치명적 에러 (Spine 로드 실패). 전체 화면 차단, 재시작 필요
- error-store 구독
- i18n 텍스트 사용

**참고 문서:**
- `docs/mascot-architecture.md` §7.2 — WebView 에러 처리
- `docs/mascot-product-spec.md` §5 — 오류는 폴백으로 가리지 않음

**Step 1: ErrorToast 작성**

`apps/webview/src/components/ErrorToast.tsx`:
```tsx
import { useEffect } from 'react';
import { useErrorStore, type AppErrorEntry } from '../stores/error-store';
import { useTranslation } from 'react-i18next';

const AUTO_DISMISS_MS = 5000;

export function ErrorToast() {
  const errors = useErrorStore((s) => s.errors);
  const dismiss = useErrorStore((s) => s.dismiss);
  const { t } = useTranslation();

  if (errors.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      right: 16,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxWidth: 360,
    }}>
      {errors.map((err, i) => (
        <ErrorToastItem key={`${err.ts}-${i}`} error={err} index={i} onDismiss={dismiss} dismissLabel={t('error.dismiss')} />
      ))}
    </div>
  );
}

function ErrorToastItem({
  error, index, onDismiss, dismissLabel,
}: {
  error: AppErrorEntry;
  index: number;
  onDismiss: (i: number) => void;
  dismissLabel: string;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(index), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [index, onDismiss]);

  return (
    <div style={{
      background: 'rgba(220, 38, 38, 0.9)',
      color: '#fff',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 13,
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: 11, opacity: 0.8 }}>{error.source}</span>
        <button
          onClick={() => onDismiss(index)}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 12,
            opacity: 0.7,
            padding: '0 4px',
          }}
        >
          {dismissLabel}
        </button>
      </div>
      <span>{error.message}</span>
    </div>
  );
}
```

**Step 2: ErrorOverlay 작성**

`apps/webview/src/components/ErrorOverlay.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

interface ErrorOverlayProps {
  message: string;
}

export function ErrorOverlay({ message }: ErrorOverlayProps) {
  const { t } = useTranslation();

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 16,
      color: '#fff',
      fontFamily: 'sans-serif',
    }}>
      <div style={{ fontSize: 20, fontWeight: 'bold', color: '#ef4444' }}>
        {t('error.fatal')}
      </div>
      <div style={{
        fontSize: 14,
        maxWidth: 480,
        textAlign: 'center',
        lineHeight: 1.6,
        opacity: 0.8,
        padding: '0 24px',
      }}>
        {message}
      </div>
    </div>
  );
}
```

**Step 3: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add apps/webview/src/components/ErrorToast.tsx apps/webview/src/components/ErrorOverlay.tsx
git commit -m "feat(phase4): add ErrorToast and ErrorOverlay components"
```

---

## Task 10: ResumeModal — 에이전트 이력서 모달

**Files:**
- Create: `apps/webview/src/components/ResumeModal.tsx`

**Context:**
- 시스템 트레이 "에이전트 이력서" 클릭 → `mascot://open-resume-modal` 이벤트 → ui-store → 모달 표시
- 탭: 전체 / 정규직(employee) / 계약직(contractor)
- 워크스페이스별 섹션 분류
- 에이전트 카드: 이름, 역할, 상태, 작업, thinking
- 카드 클릭 시 상세 이력서 (getAgentResume)
- 클릭 통과(click-through)를 일시 해제해야 모달 조작 가능

**참고 문서:**
- `docs/mascot-product-spec.md` §4.2 — 이력서 모달 레이아웃
- `docs/mascot-ipc-protocol.md` §3.1 — get_agent_resume 명령
- `apps/webview/src/i18n/ko.json` — resume 섹션 번역

**Step 1: ResumeModal 작성**

`apps/webview/src/components/ResumeModal.tsx`:
```tsx
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent-store';
import { useUiStore } from '../stores/ui-store';
import { toggleClickThrough, getAgentResume } from '../tauri/commands';
import type { MascotAgent, EmploymentType } from '../types/agent';
import type { AgentResume } from '../types/ipc';

type FilterTab = 'all' | 'employee' | 'contractor';

export function ResumeModal() {
  const show = useUiStore((s) => s.showResumeModal);
  const setShow = useUiStore((s) => s.setShowResumeModal);
  const getAllAgents = useAgentStore((s) => s.getAllAgents);
  const agentsByWorkspace = useAgentStore((s) => s.agentsByWorkspace);
  const { t } = useTranslation();

  const [tab, setTab] = useState<FilterTab>('all');
  const [selectedResume, setSelectedResume] = useState<AgentResume | null>(null);

  // 모달 열림/닫힘 시 click-through 토글
  useEffect(() => {
    if (show) {
      toggleClickThrough(false).catch(console.error);
    }
    return () => {
      if (show) {
        toggleClickThrough(true).catch(console.error);
      }
    };
  }, [show]);

  if (!show) return null;

  const allAgents = getAllAgents();
  const filtered = tab === 'all'
    ? allAgents
    : allAgents.filter((a) => a.employment_type === tab);

  // 워크스페이스별 그룹핑
  const grouped = new Map<string, MascotAgent[]>();
  for (const agent of filtered) {
    const list = grouped.get(agent.workspace_id) ?? [];
    list.push(agent);
    grouped.set(agent.workspace_id, list);
  }

  const handleAgentClick = async (agentId: string) => {
    try {
      const resume = await getAgentResume(agentId);
      setSelectedResume(resume);
    } catch {
      // error-store에 이미 push됨
    }
  };

  const handleClose = () => {
    setShow(false);
    setSelectedResume(null);
  };

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: t('resume.all') },
    { key: 'employee', label: t('resume.employee') },
    { key: 'contractor', label: t('resume.contractor') },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          minWidth: 480,
          maxWidth: 640,
          maxHeight: '80vh',
          overflowY: 'auto',
          color: '#e0e0e0',
          fontFamily: 'sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('resume.title')}</h2>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#999',
              fontSize: 20,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setSelectedResume(null); }}
              style={{
                padding: '6px 16px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                background: tab === t.key ? '#4a4a8a' : '#2a2a4a',
                color: tab === t.key ? '#fff' : '#999',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 상세 이력서 보기 */}
        {selectedResume ? (
          <ResumeDetail resume={selectedResume} onBack={() => setSelectedResume(null)} />
        ) : (
          /* 에이전트 목록 */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {Array.from(grouped.entries()).map(([wsId, agents]) => (
              <div key={wsId}>
                <div style={{
                  fontSize: 12,
                  color: '#888',
                  borderBottom: '1px solid #333',
                  paddingBottom: 4,
                  marginBottom: 8,
                }}>
                  {wsId}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {agents.map((agent) => (
                    <AgentCard
                      key={agent.agent_id}
                      agent={agent}
                      onClick={() => handleAgentClick(agent.agent_id)}
                    />
                  ))}
                </div>
              </div>
            ))}
            {grouped.size === 0 && (
              <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>
                No agents
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent, onClick }: { agent: MascotAgent; onClick: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      onClick={onClick}
      style={{
        background: '#2a2a4a',
        borderRadius: 8,
        padding: '10px 14px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: 14 }}>{agent.display_name}</span>
        <span style={{
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 4,
          background: '#3a3a6a',
          color: '#aaa',
        }}>
          {t(`status.${agent.status}`)}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#888' }}>
        {agent.role} / {t(`resume.${agent.employment_type}`)}
      </div>
      {agent.current_task && (
        <div style={{ fontSize: 12, color: '#aaa' }}>
          {t('resume.task')}: {agent.current_task}
        </div>
      )}
    </div>
  );
}

function ResumeDetail({ resume, onBack }: { resume: AgentResume; onBack: () => void }) {
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: '#888',
          cursor: 'pointer',
          fontSize: 13,
          textAlign: 'left',
          padding: 0,
        }}
      >
        ← Back
      </button>

      <div style={{ background: '#2a2a4a', borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 'bold' }}>{resume.agent.display_name}</div>
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
          {resume.agent.role} / {t(`resume.${resume.agent.employment_type}`)}
        </div>
        <div style={{ fontSize: 13, color: '#aaa', marginTop: 8 }}>
          {t('resume.status')}: {t(`status.${resume.agent.status}`)}
        </div>
        {resume.agent.current_task && (
          <div style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>
            {t('resume.task')}: {resume.agent.current_task}
          </div>
        )}
      </div>

      <div style={{ fontSize: 13, color: '#888' }}>
        완료 작업: {resume.total_tasks_completed} / 사용 도구: {resume.total_tools_used}
      </div>

      <div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>최근 활동</div>
        {resume.recent_events.map((evt, i) => (
          <div key={i} style={{
            fontSize: 12,
            padding: '4px 0',
            borderBottom: '1px solid #222',
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span style={{ color: '#aaa' }}>{evt.summary}</span>
            <span style={{ color: '#666', fontSize: 11 }}>
              {new Date(evt.ts).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add apps/webview/src/components/ResumeModal.tsx
git commit -m "feat(phase4): add ResumeModal with tabs and agent resume detail"
```

---

## Task 11: App.tsx 통합 + 빌드 검증

**Files:**
- Modify: `apps/webview/src/App.tsx`
- Create: `apps/webview/src/pixi/index.ts` (barrel export)

**Context:**
- MascotStage 생성 → canvas 마운트 (React ref 사용)
- CharacterManager 초기화 → Spine 에셋 로드
- Zustand store 이벤트 → CharacterManager 연동
- React 오버레이 컴포넌트 추가 (ErrorToast, ResumeModal, ErrorOverlay)
- Spine 로드 실패 → ErrorOverlay 표시
- 최종 빌드 + Rust 빌드 통합 검증

**참고 문서:**
- `docs/mascot-ipc-protocol.md` §5 — 초기화 시퀀스

**Step 1: pixi barrel export**

`apps/webview/src/pixi/index.ts`:
```typescript
export { MascotStage } from './MascotStage';
export { CharacterManager } from './CharacterManager';
export { SpineCharacter } from './SpineCharacter';
export { SpeechBubble } from './SpeechBubble';
export { WorkspaceLabel } from './WorkspaceLabel';
```

**Step 2: App.tsx 재작성**

`apps/webview/src/App.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useAgentStore } from './stores/agent-store';
import { useErrorStore } from './stores/error-store';
import { useUiStore } from './stores/ui-store';
import { getAllAgents, getDisplayConfig } from './tauri/commands';
import {
  onAgentAppeared,
  onAgentUpdate,
  onAgentDeparted,
  onError,
  onOpenResumeModal,
  onSettingsChanged,
} from './tauri/events';
import { MascotStage } from './pixi/MascotStage';
import { CharacterManager } from './pixi/CharacterManager';
import { ErrorToast } from './components/ErrorToast';
import { ErrorOverlay } from './components/ErrorOverlay';
import { ResumeModal } from './components/ResumeModal';
import type { DisplayConfig } from './types/ipc';

function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<MascotStage | null>(null);
  const managerRef = useRef<CharacterManager | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const addAgent = useAgentStore((s) => s.addAgent);
  const updateStatus = useAgentStore((s) => s.updateStatus);
  const removeAgent = useAgentStore((s) => s.removeAgent);
  const pushError = useErrorStore((s) => s.push);
  const setDisplayConfig = useUiStore((s) => s.setDisplayConfig);
  const setShowResumeModal = useUiStore((s) => s.setShowResumeModal);

  useEffect(() => {
    let destroyed = false;

    const initialize = async () => {
      try {
        // 1. DisplayConfig 로드
        const config = await getDisplayConfig();
        setDisplayConfig(config);

        if (destroyed || !canvasRef.current) return;

        // 2. MascotStage 초기화
        const stage = new MascotStage();
        await stage.init(canvasRef.current, config);
        stageRef.current = stage;

        // 3. CharacterManager 초기화 + Spine 로드
        const manager = new CharacterManager(stage, config);
        try {
          await manager.loadSpineAsset();
        } catch (e) {
          setFatalError(`Spine 에셋 로드 실패: ${String(e)}`);
          return;
        }
        managerRef.current = manager;

        if (destroyed) {
          manager.destroy();
          stage.destroy();
          return;
        }

        // 4. 기존 에이전트 복원
        const agents = await getAllAgents();
        for (const agent of agents) {
          addAgent(agent);
          manager.addAgent(agent);
        }

        // 5. 이벤트 리스너 등록
        const unlisteners = await Promise.all([
          onAgentAppeared((p) => {
            const agent = {
              agent_id: p.agent_id,
              display_name: p.display_name,
              role: p.role,
              employment_type: p.employment_type,
              workspace_id: p.workspace_id,
              status: p.status,
              thinking_text: null,
              current_task: null,
              appearance: p.appearance,
              last_active_ts: p.ts,
            };
            addAgent(agent);
            managerRef.current?.addAgent(agent);
          }),
          onAgentUpdate((p) => {
            updateStatus(p.agent_id, p.status, {
              thinking_text: p.thinking_text,
              current_task: p.current_task,
            });
            managerRef.current?.updateAgent(p);
          }),
          onAgentDeparted((p) => {
            removeAgent(p.agent_id);
            managerRef.current?.removeAgent(p.agent_id);
          }),
          onError((p) => {
            pushError(p);
          }),
          onOpenResumeModal(() => {
            setShowResumeModal(true);
          }),
          onSettingsChanged((_p) => {
            // 설정 변경 시 config 리로드
            getDisplayConfig()
              .then((newConfig) => {
                setDisplayConfig(newConfig);
                stageRef.current?.updateDisplayConfig(newConfig);
                managerRef.current?.updateDisplayConfig(newConfig);
              })
              .catch(console.error);
          }),
        ]);

        // cleanup 등록
        return () => {
          unlisteners.forEach((fn) => fn());
        };
      } catch (e) {
        setFatalError(`초기화 실패: ${String(e)}`);
      }
    };

    let cleanupEvents: (() => void) | undefined;
    initialize().then((cleanup) => {
      cleanupEvents = cleanup;
    });

    return () => {
      destroyed = true;
      cleanupEvents?.();
      managerRef.current?.destroy();
      stageRef.current?.destroy();
    };
  }, []);

  if (fatalError) {
    return <ErrorOverlay message={fatalError} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', background: 'transparent' }}>
      <div ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <ErrorToast />
      <ResumeModal />
    </div>
  );
}

export default App;
```

**Step 3: .gitkeep 제거 (더 이상 필요 없음)**

```bash
rm -f apps/webview/src/pixi/.gitkeep apps/webview/src/components/.gitkeep
```

**Step 4: 타입 체크**

```bash
cd apps/webview && npx tsc --noEmit
```

Expected: 에러 없음.

**Step 5: WebView 빌드 확인**

```bash
cd apps/webview && pnpm run build
```

Expected: 빌드 성공.

**Step 6: Rust 빌드 + 테스트**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: 기존 56 tests 전부 통과.

**Step 7: Commit**

```bash
git add apps/webview/src/ src-tauri/
git commit -m "feat(phase4): integrate PixiJS stage, CharacterManager, and React overlays in App.tsx"
```

---

## 수동 테스트 체크리스트

Phase 4 완료 후 Spine placeholder 에셋이 준비되면 아래를 확인:

### 기본 렌더링
- [ ] `tauri dev`로 앱 실행 — 투명 윈도우 표시
- [ ] Spine 에셋 로드 성공 시 에러 없음
- [ ] Spine 에셋 없을 때 ErrorOverlay 표시 ("Spine 에셋 로드 실패")

### 캐릭터 등장/퇴장
- [ ] hook 이벤트 수신 → 캐릭터 등장 (appear 애니메이션)
- [ ] appear 완료 → idle 애니메이션으로 전환
- [ ] agent_stopped → disappear 애니메이션 → 캐릭터 제거

### 상태 애니메이션
- [ ] working → working 애니메이션 + 말풍선 (작업 내용)
- [ ] thinking → thinking 애니메이션 + 말풍선 (thinking 텍스트)
- [ ] failed → failed 애니메이션 + 말풍선 ("실패")
- [ ] completed → celebrate 애니메이션 → idle 자동 전환
- [ ] resting → resting 애니메이션 + 💤 말풍선
- [ ] startled → startled 애니메이션 + ❗ 말풍선

### 이동
- [ ] walking → 상대에게 이동 (z-index 낮춰서 뒤로)
- [ ] 도착 → arrive_at_peer synthetic event → chatting
- [ ] returning → 자기 자리로 복귀
- [ ] 도착 → arrive_at_home synthetic event → 이전 상태 복원

### 다중 캐릭터
- [ ] 같은 워크스페이스 → character_spacing 간격으로 배치
- [ ] 다른 워크스페이스 → group_spacing 간격 + WorkspaceLabel 표시

### React 오버레이
- [ ] ErrorToast: 에러 발생 시 우하단에 표시, 5초 후 자동 사라짐
- [ ] ResumeModal: 시스템 트레이 → 에이전트 이력서 → 모달 표시
- [ ] ResumeModal 탭 전환 (전체/정규직/계약직)
- [ ] ResumeModal 에이전트 클릭 → 상세 이력서

---

## 결정 사항

| 결정 | 이유 |
|------|------|
| Spine 에셋을 `public/spine/`에 배치 | Vite static serving, import 없이 URL 접근 |
| 그라디언트 맵 셰이더를 Phase 4에서 제외 | placeholder 아트로는 채널 패킹 테스트 불가, 별도 Phase에서 구현 |
| 간단한 slot tinting으로 시작 | end-to-end 파이프라인 검증이 우선, 색상 퀄리티는 나중 |
| movement 값을 DisplayConfig에 합침 | 별도 IPC 명령 추가보다 기존 구조 확장이 효율적 |
| ErrorOverlay를 React로 구현 | PixiJS 위에 표시해야 하고, 사용자 인터랙션 필요 |
| ResumeModal에서 click-through 해제 | 모달 조작하려면 클릭이 WebView에 도달해야 함 |
