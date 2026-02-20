import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Z_INDEX } from './constants';

/** Visual design constants for workspace label layout */
const LABEL_PADDING_X = 8;
const LABEL_PADDING_Y = 3;
const LABEL_RADIUS = 4;
const LABEL_OFFSET_Y = -12;

/**
 * A PixiJS text label shown above each workspace group.
 *
 * Renders a dark semi-transparent rounded-rect background
 * with the workspace name centered inside.
 */
export class WorkspaceLabel {
  readonly container: Container;

  private readonly bg: Graphics;
  private readonly label: Text;

  constructor(workspaceId: string) {
    this.container = new Container();
    this.container.zIndex = Z_INDEX.LABEL;

    this.bg = new Graphics();
    this.container.addChild(this.bg);

    this.label = new Text({
      text: workspaceId,
      style: new TextStyle({
        fontFamily: 'sans-serif',
        fontSize: 11,
        fontWeight: 'bold',
        fill: 0xcccccc,
        letterSpacing: 0.5,
      }),
    });
    this.label.x = LABEL_PADDING_X;
    this.label.y = LABEL_PADDING_Y;
    this.container.addChild(this.label);

    this.drawBackground();
  }

  /**
   * Position the label centered above a workspace group.
   *
   * @param groupCenterX - The horizontal center of the workspace group
   * @param topY - The top Y coordinate of the workspace group
   */
  updatePosition(groupCenterX: number, topY: number): void {
    const bgWidth = this.label.width + LABEL_PADDING_X * 2;
    this.container.x = groupCenterX - bgWidth / 2;
    this.container.y = topY + LABEL_OFFSET_Y;
  }

  /** Clean up and destroy the container and its children. */
  destroy(): void {
    this.container.destroy({ children: true });
  }

  /** Draw the dark semi-transparent rounded-rect background. */
  private drawBackground(): void {
    const bgWidth = this.label.width + LABEL_PADDING_X * 2;
    const bgHeight = this.label.height + LABEL_PADDING_Y * 2;

    this.bg.clear();
    this.bg
      .roundRect(0, 0, bgWidth, bgHeight, LABEL_RADIUS)
      .fill({ color: 0x000000, alpha: 0.4 });
  }
}
