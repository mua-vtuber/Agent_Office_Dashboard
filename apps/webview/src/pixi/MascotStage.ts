import { Application } from 'pixi.js';
import type { DisplayConfig } from '../types/ipc';

export class MascotStage {
  readonly app: Application;
  private displayConfig: DisplayConfig | null = null;

  constructor() {
    this.app = new Application();
  }

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
  }

  /** Ground Y position — where characters' feet should be */
  get groundY(): number {
    if (!this.displayConfig) return window.innerHeight;
    return window.innerHeight - this.displayConfig.taskbar_offset_px;
  }

  /** Activity zone height from config */
  get activityZoneHeight(): number {
    return this.displayConfig?.activity_zone_height_px ?? 120;
  }

  updateDisplayConfig(config: DisplayConfig): void {
    this.displayConfig = config;
  }

  destroy(): void {
    this.app.destroy(true);
  }
}
