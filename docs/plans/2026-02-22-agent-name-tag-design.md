# 에이전트 네임 태그 설계

## 요구사항

각 캐릭터 머리 위에 게임 길드명 표시처럼 2줄 라벨을 표시한다.

```
  [my-project]    ← 워크스페이스/프로젝트명 (작은 폰트, 연한 색)
   Agent Name     ← 에이전트 이름
  🧑 Character
```

- 캐릭터별 개별 표시 (기존 그룹 WorkspaceLabel 제거)
- 드래그/비행 중에도 캐릭터를 따라감

## 아키텍처

### AgentNameTag 컴포넌트

`WorkspaceLabel`과 같은 패턴의 PixiJS 컴포넌트.
2줄 텍스트 + 반투명 배경 rounded-rect.

```
Container (AgentNameTag)
├─ Graphics (bg: 반투명 검정 rounded-rect)
├─ Text (workspaceName: 작은 폰트, 연한 색)
└─ Text (agentName: 약간 큰 폰트, 밝은 색)
```

### 스타일

| 요소 | 폰트 크기 | 색상 | 정렬 |
|---|---|---|---|
| 워크스페이스명 | 9px | #999999 | 중앙 |
| 에이전트명 | 11px, bold | #dddddd | 중앙 |
| 배경 | — | 검정 alpha 0.35 | rounded-rect, radius 4 |

### 위치 전략

`SpineCharacter.container`의 자식으로 추가하면 드래그/비행 시 자동 추적된다.
Spine의 원점(발바닥)으로부터 Y 오프셋으로 머리 위에 배치.

```
container (SpineCharacter)
├─ Spine (캐릭터 본체)
└─ AgentNameTag (y = -(spine.height + padding))
    ├─ bg
    ├─ workspaceName
    └─ agentName
```

SpineCharacter.container에 직접 추가하면:
- 드래그/비행 시 자동으로 따라감 (별도 위치 갱신 불필요)
- zIndex는 부모(container)를 따르므로 DRAGGED 시 함께 올라감
- scaleX 플립(방향 전환) 시 텍스트도 뒤집히는 문제 → 매 프레임 보정 필요

### scaleX 보정

SpineCharacter가 `setFacing(-1)`으로 좌우 반전하면 자식도 뒤집힌다.
AgentNameTag의 scaleX를 부모의 반대로 설정해서 항상 정방향 유지:

```typescript
// SpineCharacter.setFacing() 또는 ticker에서
this.nameTag.container.scale.x = 1 / this.spine.skeleton.scaleX;
```

### 기존 WorkspaceLabel 제거

- `WorkspaceLabel.ts` 파일 삭제
- `pixi/index.ts`에서 export 제거
- `CharacterManager`에서 `WorkspaceGroup.label` 필드 제거
- `WorkspaceGroup` 인터페이스를 `string[]`로 단순화 (agentIds만 남음)
- `recalculatePositions()`에서 WorkspaceLabel 위치 갱신 코드 제거

### CharacterManager 변경

```typescript
interface CharacterEntry {
  character: SpineCharacter;
  bubble: SpeechBubble;
  nameTag: AgentNameTag;       // 추가
  workspaceId: string;
}
```

`addAgent()`에서:
1. `AgentNameTag` 생성 (display_name + workspace_id)
2. `SpineCharacter.container`에 자식으로 추가
3. `CharacterEntry.nameTag`에 저장

`removeAgent()`에서:
1. `nameTag.destroy()` 호출

### SpeechBubble과의 관계

SpeechBubble은 현재 `character.container`와 별도로 stage에 추가되어 있다.
AgentNameTag는 `character.container`의 자식이므로 SpeechBubble과 겹칠 수 있다.

해결: SpeechBubble이 보일 때 AgentNameTag를 숨기거나,
SpeechBubble의 Y를 AgentNameTag 높이만큼 위로 올린다.

→ **SpeechBubble 보일 때 AgentNameTag 숨김** (심플)

## 변경 파일

| 파일 | 변경 |
|---|---|
| `pixi/AgentNameTag.ts` | 신규 생성 |
| `pixi/SpineCharacter.ts` | nameTag 자식 추가, setFacing에서 scaleX 보정 |
| `pixi/CharacterManager.ts` | CharacterEntry에 nameTag 추가, WorkspaceLabel 관련 코드 제거 |
| `pixi/WorkspaceLabel.ts` | 삭제 |
| `pixi/index.ts` | export 변경 |
| `pixi/constants.ts` | Z_INDEX.LABEL 유지 (AgentNameTag에서 사용 안 함 — 부모 zIndex 상속) |
