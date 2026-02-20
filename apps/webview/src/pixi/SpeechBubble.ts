import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Z_INDEX } from './constants';

/** Visual design constants for speech bubble layout */
const BUBBLE_PADDING_X = 10;
const BUBBLE_PADDING_Y = 6;
const BUBBLE_RADIUS = 8;
const BUBBLE_TAIL_SIZE = 6;
const BUBBLE_MAX_WIDTH = 200;
const BUBBLE_OFFSET_Y = -20;

/**
 * A PixiJS-based speech bubble that floats above a character.
 *
 * Renders a white rounded-rect background with a triangular tail
 * pointing downward and displays text inside. Supports auto-fade
 * after a configurable duration and text truncation.
 */
export class SpeechBubble {
  readonly container: Container;

  private readonly bg: Graphics;
  private readonly label: Text;
  private maxChars = 80;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.container = new Container();
    this.container.zIndex = Z_INDEX.BUBBLE;
    this.container.visible = false;

    this.bg = new Graphics();
    this.container.addChild(this.bg);

    this.label = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'sans-serif',
        fontSize: 12,
        fill: 0x333333,
        wordWrap: true,
        wordWrapWidth: BUBBLE_MAX_WIDTH - BUBBLE_PADDING_X * 2,
      }),
    });
    this.label.x = BUBBLE_PADDING_X;
    this.label.y = BUBBLE_PADDING_Y;
    this.container.addChild(this.label);

    this.container.y = BUBBLE_OFFSET_Y;
  }

  /**
   * Display text in the bubble. If fadeMs is provided (> 0),
   * the bubble will auto-hide after that many milliseconds.
   */
  show(text: string, fadeMs?: number): void {
    this.clearFadeTimer();

    const displayText = this.truncate(text);
    this.label.text = displayText;

    this.redrawBackground();
    this.centerHorizontally();

    this.container.visible = true;

    if (fadeMs !== undefined && fadeMs > 0) {
      this.fadeTimer = setTimeout(() => {
        this.hide();
      }, fadeMs);
    }
  }

  /** Hide the bubble and cancel any pending auto-fade timer. */
  hide(): void {
    this.clearFadeTimer();
    this.container.visible = false;
  }

  /** Set the maximum character limit for displayed text. */
  setMaxChars(max: number): void {
    this.maxChars = max;
  }

  /** Clean up timers and destroy the container. */
  destroy(): void {
    this.clearFadeTimer();
    this.container.destroy({ children: true });
  }

  /** Truncate text to maxChars, appending "..." if needed. */
  private truncate(text: string): string {
    if (text.length <= this.maxChars) {
      return text;
    }
    return text.slice(0, this.maxChars) + '...';
  }

  /** Redraw the rounded-rect background and tail to fit current text. */
  private redrawBackground(): void {
    const textWidth = this.label.width;
    const textHeight = this.label.height;

    const bgWidth = textWidth + BUBBLE_PADDING_X * 2;
    const bgHeight = textHeight + BUBBLE_PADDING_Y * 2;

    this.bg.clear();

    // Rounded rectangle body
    this.bg
      .roundRect(0, 0, bgWidth, bgHeight, BUBBLE_RADIUS)
      .fill({ color: 0xffffff, alpha: 0.92 });

    // Triangular tail at bottom center pointing down
    const tailCenterX = bgWidth / 2;
    this.bg
      .moveTo(tailCenterX - BUBBLE_TAIL_SIZE, bgHeight)
      .lineTo(tailCenterX, bgHeight + BUBBLE_TAIL_SIZE)
      .lineTo(tailCenterX + BUBBLE_TAIL_SIZE, bgHeight)
      .closePath()
      .fill({ color: 0xffffff, alpha: 0.92 });
  }

  /** Center the bubble horizontally so the tail is above the character center. */
  private centerHorizontally(): void {
    const textWidth = this.label.width;
    const bgWidth = textWidth + BUBBLE_PADDING_X * 2;
    const textHeight = this.label.height;
    const bgHeight = textHeight + BUBBLE_PADDING_Y * 2;

    // Shift so the center of the bubble is at x=0
    this.container.pivot.x = bgWidth / 2;
    // Shift so the bottom of the tail is at the offset Y position
    this.container.pivot.y = bgHeight + BUBBLE_TAIL_SIZE;
  }

  /** Cancel any pending auto-fade timer. */
  private clearFadeTimer(): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
