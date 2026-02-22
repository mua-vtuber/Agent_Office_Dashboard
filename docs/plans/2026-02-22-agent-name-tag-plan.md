# Agent Name Tag Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 각 캐릭터 머리 위에 게임 길드명처럼 2줄 라벨(워크스페이스명 + 에이전트명)을 표시하고, 기존 그룹 단위 WorkspaceLabel을 제거한다.

**Architecture:** AgentNameTag를 SpineCharacter.container의 자식으로 추가하여 드래그/물리/이동 시 자동 추적한다. setFacing 시 scaleX 보정으로 텍스트 뒤집힘을 방지한다. SpeechBubble 표시 중에는 AgentNameTag를 숨긴다.

**Tech Stack:** PixiJS v8 (Container, Graphics, Text, TextStyle)

---

### Task 1: AgentNameTag 컴포넌트 생성

**Files:**
- Create: `apps/webview/src/pixi/AgentNameTag.ts`

**Step 1: AgentNameTag.ts 작성**

```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/** Visual design constants for agent name tag */
const TAG_PADDING_X = 6;
const TAG_PADDING_Y = 2;
const TAG_RADIUS = 4;
const TAG_GAP = 1; // gap between workspace and agent name lines

/**
 * A 2-line PixiJS label shown above each character (like game guild names).
 *
 * Line 1: workspace/project name (small, dim)
 * Line 2: agent display name (slightly larger, bright)
 *
 * Added as a child of SpineCharacter.container so it automatically
 * follows the character during drag, flight, and movement.
 */
export class AgentNameTag {
  readonly container: Container;

  private readonly bg: Graphics;
  private readonly workspaceText: Text;
  private readonly agentText: Text;

  constructor(displayName: string, workspaceId: string) {
    this.container = new Container();

    this.bg = new Graphics();
    this.container.addChild(this.bg);

    this.workspaceText = new Text({
      text: workspaceId,
      style: new TextStyle({
        fontFamily: 'sans-serif',
        fontSize: 9,
        fill: 0x999999,
      }),
    });
    this.container.addChild(this.workspaceText);

    this.agentText = new Text({
      text: displayName,
      style: new TextStyle({
        fontFamily: 'sans-serif',
        fontSize: 11,
        fontWeight: 'bold',
        fill: 0xdddddd,
      }),
    });
    this.container.addChild(this.agentText);

    this.layout();
  }

  /** Update the workspace name text. */
  setWorkspace(workspaceId: string): void {
    this.workspaceText.text = workspaceId;
    this.layout();
  }

  /** Recalculate text positions and background size. */
  private layout(): void {
    const contentWidth = Math.max(this.workspaceText.width, this.agentText.width);
    const totalTextHeight = this.workspaceText.height + TAG_GAP + this.agentText.height;
    const bgWidth = contentWidth + TAG_PADDING_X * 2;
    const bgHeight = totalTextHeight + TAG_PADDING_Y * 2;

    // Center workspace text
    this.workspaceText.x = (bgWidth - this.workspaceText.width) / 2;
    this.workspaceText.y = TAG_PADDING_Y;

    // Center agent text
    this.agentText.x = (bgWidth - this.agentText.width) / 2;
    this.agentText.y = TAG_PADDING_Y + this.workspaceText.height + TAG_GAP;

    // Draw background
    this.bg.clear();
    this.bg
      .roundRect(0, 0, bgWidth, bgHeight, TAG_RADIUS)
      .fill({ color: 0x000000, alpha: 0.35 });

    // Center the entire container so pivot is at horizontal center
    this.container.pivot.x = bgWidth / 2;
    // Pivot at bottom so container.y = top of character places tag above
    this.container.pivot.y = bgHeight;
  }

  /** Clean up and destroy. */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
```

**Step 2: tsc로 컴파일 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 3: 커밋**

```bash
git add apps/webview/src/pixi/AgentNameTag.ts
git commit -m "feat: add AgentNameTag component for per-character name labels"
```

---

### Task 2: pixi/index.ts export 업데이트

**Files:**
- Modify: `apps/webview/src/pixi/index.ts`

**Step 1: AgentNameTag export 추가, WorkspaceLabel export 제거**

변경 전:
```typescript
export { MascotStage } from './MascotStage';
export { CharacterManager } from './CharacterManager';
export { DragController } from './DragController';
export { SpineCharacter } from './SpineCharacter';
export { SpeechBubble } from './SpeechBubble';
export { WorkspaceLabel } from './WorkspaceLabel';
```

변경 후:
```typescript
export { MascotStage } from './MascotStage';
export { CharacterManager } from './CharacterManager';
export { DragController } from './DragController';
export { SpineCharacter } from './SpineCharacter';
export { SpeechBubble } from './SpeechBubble';
export { AgentNameTag } from './AgentNameTag';
```

**Step 2: tsc 확인** (WorkspaceLabel 외부 참조 없으면 통과, 있으면 Task 3에서 해결)

Run: `cd apps/webview && npx tsc --noEmit`

**Step 3: 커밋**

```bash
git add apps/webview/src/pixi/index.ts
git commit -m "feat: update pixi exports — add AgentNameTag, remove WorkspaceLabel"
```

---

### Task 3: SpineCharacter에 nameTag 자식 추가 + scaleX 보정

**Files:**
- Modify: `apps/webview/src/pixi/SpineCharacter.ts:1-6,36-47,188-190`

**Step 1: import 추가 + nameTag 필드 + constructor에서 자식 추가**

`SpineCharacter.ts` 상단 import 에 추가:
```typescript
import { AgentNameTag } from './AgentNameTag';
```

클래스에 필드 추가 (line 34 부근):
```typescript
private _nameTag: AgentNameTag | null = null;
```

constructor에 nameTag 마운트 메서드 추가 (public):
```typescript
/** Attach an AgentNameTag as a child of the character container. */
attachNameTag(nameTag: AgentNameTag): void {
  this._nameTag = nameTag;
  this.container.addChild(nameTag.container);
  this.updateNameTagPosition();
}

/** Get the attached name tag. */
get nameTag(): AgentNameTag | null {
  return this._nameTag;
}
```

nameTag 위치 갱신 (Spine 높이 기반 Y offset):
```typescript
/** Update name tag Y position based on spine bounds. */
private updateNameTagPosition(): void {
  if (!this._nameTag) return;
  // Spine origin = feet. Tag sits above the head.
  // spine.getBounds() gives local bounds; use height as offset.
  const bounds = this.spine.getBounds();
  this._nameTag.container.x = 0; // centered via pivot
  this._nameTag.container.y = -(bounds.height + 4);
}
```

**Step 2: setFacing에서 nameTag scaleX 보정**

`setFacing()` (line 188) 수정:

변경 전:
```typescript
setFacing(direction: 1 | -1): void {
  this.spine.skeleton.scaleX = Math.abs(this.spine.skeleton.scaleX) * direction;
}
```

변경 후:
```typescript
setFacing(direction: 1 | -1): void {
  this.spine.skeleton.scaleX = Math.abs(this.spine.skeleton.scaleX) * direction;
  // Counter-flip name tag so text stays readable
  if (this._nameTag) {
    this._nameTag.container.scale.x = direction;
  }
}
```

**Step 3: startDrag / endDrag에서 nameTag 위치 갱신**

`startDrag()` 끝에 추가:
```typescript
this.updateNameTagPosition();
```

**Step 4: destroy에서 nameTag 정리**

`destroy()` 수정 — nameTag는 container의 자식이므로 `{ children: true }`가 처리하지만, 참조 정리:

변경 전:
```typescript
destroy(): void {
  this.spine.state.clearListeners();
  this.container.destroy({ children: true });
}
```

변경 후:
```typescript
destroy(): void {
  this.spine.state.clearListeners();
  this._nameTag = null;
  this.container.destroy({ children: true });
}
```

**Step 5: tsc 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 6: 커밋**

```bash
git add apps/webview/src/pixi/SpineCharacter.ts
git commit -m "feat: SpineCharacter — attach AgentNameTag with scaleX counter-flip"
```

---

### Task 4: CharacterManager 통합 — nameTag 생성/제거 + bubble 연동

**Files:**
- Modify: `apps/webview/src/pixi/CharacterManager.ts`

**Step 1: import 교체**

변경 전:
```typescript
import { WorkspaceLabel } from './WorkspaceLabel';
```

변경 후:
```typescript
import { AgentNameTag } from './AgentNameTag';
```

**Step 2: WorkspaceGroup interface 단순화**

변경 전:
```typescript
interface WorkspaceGroup {
  label: WorkspaceLabel;
  agentIds: string[];
}
```

변경 후:
```typescript
interface WorkspaceGroup {
  agentIds: string[];
}
```

**Step 3: CharacterEntry에 nameTag 추가**

변경 전:
```typescript
interface CharacterEntry {
  character: SpineCharacter;
  bubble: SpeechBubble;
  workspaceId: string;
}
```

변경 후:
```typescript
interface CharacterEntry {
  character: SpineCharacter;
  bubble: SpeechBubble;
  nameTag: AgentNameTag;
  workspaceId: string;
}
```

**Step 4: addAgent()에서 nameTag 생성 + 부착**

`addAgent()` 메서드에서, SpeechBubble 생성 후:

```typescript
// Create AgentNameTag
const nameTag = new AgentNameTag(agent.display_name, agent.workspace_id);
character.attachNameTag(nameTag);
```

CharacterEntry에 nameTag 추가:
```typescript
const entry: CharacterEntry = {
  character,
  bubble,
  nameTag,
  workspaceId: agent.workspace_id,
};
```

**Step 5: removeAgent()에서 nameTag 정리**

`removeAgent()` 에서 `entry.bubble.destroy()` 다음에:
```typescript
entry.nameTag.destroy();
```

(참고: nameTag는 character.container의 자식이므로 character.destroy()에서도 파괴되지만, 참조 정리 차원에서 명시적 호출)

**Step 6: updateAgent()에서 workspace 변경 시 nameTag 갱신**

`updateAgent()` 메서드에서 workspace 변경 처리 블록:

변경 전:
```typescript
if (payload.workspace_id !== entry.workspaceId) {
  this.removeFromWorkspaceGroup(payload.agent_id, entry.workspaceId);
  entry.workspaceId = payload.workspace_id;
  this.addToWorkspaceGroup(payload.agent_id, payload.workspace_id);
  this.recalculatePositions();
}
```

변경 후:
```typescript
if (payload.workspace_id !== entry.workspaceId) {
  this.removeFromWorkspaceGroup(payload.agent_id, entry.workspaceId);
  entry.workspaceId = payload.workspace_id;
  this.addToWorkspaceGroup(payload.agent_id, payload.workspace_id);
  entry.nameTag.setWorkspace(payload.workspace_id);
  this.recalculatePositions();
}
```

**Step 7: updateBubbleForStatus()에서 nameTag 가시성 토글**

`updateBubbleForStatus()` 메서드 끝에, bubble을 show/hide한 후 nameTag 가시성을 반대로 설정:

메서드 시작 부분의 `entry.bubble.hide()` 반환 직전에:
```typescript
const shouldShow = STATUS_BUBBLE_VISIBILITY[status];
if (!shouldShow) {
  entry.bubble.hide();
  entry.nameTag.container.visible = true;
  return;
}
```

switch 문 끝(case들 이후)에 추가:
```typescript
// Hide name tag when bubble is visible
entry.nameTag.container.visible = false;
```

**Step 8: addToWorkspaceGroup() 단순화 — label 제거**

변경 전:
```typescript
private addToWorkspaceGroup(agentId: string, workspaceId: string): void {
  let group = this.workspaceGroups.get(workspaceId);
  if (!group) {
    const label = new WorkspaceLabel(workspaceId);
    this.stage.app.stage.addChild(label.container);
    group = { label, agentIds: [] };
    this.workspaceGroups.set(workspaceId, group);
  }
  if (!group.agentIds.includes(agentId)) {
    group.agentIds.push(agentId);
  }
}
```

변경 후:
```typescript
private addToWorkspaceGroup(agentId: string, workspaceId: string): void {
  let group = this.workspaceGroups.get(workspaceId);
  if (!group) {
    group = { agentIds: [] };
    this.workspaceGroups.set(workspaceId, group);
  }
  if (!group.agentIds.includes(agentId)) {
    group.agentIds.push(agentId);
  }
}
```

**Step 9: removeFromWorkspaceGroup() 단순화 — label 제거**

변경 전:
```typescript
private removeFromWorkspaceGroup(agentId: string, workspaceId: string): void {
  const group = this.workspaceGroups.get(workspaceId);
  if (!group) return;

  group.agentIds = group.agentIds.filter((id) => id !== agentId);

  if (group.agentIds.length === 0) {
    this.stage.app.stage.removeChild(group.label.container);
    group.label.destroy();
    this.workspaceGroups.delete(workspaceId);
  }
}
```

변경 후:
```typescript
private removeFromWorkspaceGroup(agentId: string, workspaceId: string): void {
  const group = this.workspaceGroups.get(workspaceId);
  if (!group) return;

  group.agentIds = group.agentIds.filter((id) => id !== agentId);

  if (group.agentIds.length === 0) {
    this.workspaceGroups.delete(workspaceId);
  }
}
```

**Step 10: recalculatePositions()에서 label 위치 갱신 코드 제거**

`recalculatePositions()` 메서드 내 workspace label 위치 갱신 3줄 제거:

삭제할 부분 (line 587-590):
```typescript
      // Position workspace label centered above the group
      const groupCenterX = groupStartX + groupWidth / 2;
      const topY = groundY - this.stage.activityZoneHeight;
      group.label.updatePosition(groupCenterX, topY);
```

**Step 11: destroy()에서 label 정리 코드 제거**

변경 전:
```typescript
destroy(): void {
  // Clean up movement ticker
  if (this.tickerCallback) {
    this.stage.app.ticker.remove(this.tickerCallback);
    this.tickerCallback = null;
  }
  this.movingAgents.clear();

  // Snapshot keys to avoid mutating the Map during iteration
  const agentIds = [...this.characters.keys()];
  for (const agentId of agentIds) {
    this.removeAgent(agentId);
  }
  // removeAgent already cleans up workspace groups, but ensure labels are gone
  for (const group of this.workspaceGroups.values()) {
    group.label.destroy();
  }
  this.workspaceGroups.clear();
}
```

변경 후:
```typescript
destroy(): void {
  // Clean up movement ticker
  if (this.tickerCallback) {
    this.stage.app.ticker.remove(this.tickerCallback);
    this.tickerCallback = null;
  }
  this.movingAgents.clear();

  // Snapshot keys to avoid mutating the Map during iteration
  const agentIds = [...this.characters.keys()];
  for (const agentId of agentIds) {
    this.removeAgent(agentId);
  }
  this.workspaceGroups.clear();
}
```

**Step 12: tsc 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 13: 커밋**

```bash
git add apps/webview/src/pixi/CharacterManager.ts
git commit -m "feat: CharacterManager — integrate AgentNameTag, remove WorkspaceLabel"
```

---

### Task 5: WorkspaceLabel.ts 삭제

**Files:**
- Delete: `apps/webview/src/pixi/WorkspaceLabel.ts`

**Step 1: 파일 삭제**

```bash
git rm apps/webview/src/pixi/WorkspaceLabel.ts
```

**Step 2: tsc 확인**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음 (모든 참조는 Task 2, 4에서 이미 제거됨)

**Step 3: 커밋**

```bash
git commit -m "refactor: delete WorkspaceLabel — replaced by per-character AgentNameTag"
```

---

### Task 6: 통합 빌드 검증

**Files:** 없음 (검증만)

**Step 1: TypeScript 전체 빌드**

Run: `cd apps/webview && npx tsc --noEmit`
Expected: 에러 없음

**Step 2: Rust 빌드**

Run: `cd src-tauri && cargo build 2>&1 | tail -5`
Expected: `Finished` (Rust 변경 없으므로 통과 필수)

**Step 3: Rust 테스트**

Run: `cd src-tauri && cargo test 2>&1 | tail -5`
Expected: 모든 테스트 통과
