import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/** Visual design constants for agent name tag */
const TAG_PADDING_X = 6;
const TAG_PADDING_Y = 2;
const TAG_RADIUS = 4;
const TAG_GAP = 1;

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
    // Pivot at bottom so positioning above character is straightforward
    this.container.pivot.y = bgHeight;
  }

  /** Clean up and destroy. */
  destroy(): void {
    this.container.destroy({ children: true });
  }
}
