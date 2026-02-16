import { Assets, Texture } from "pixi.js";
import { MARKER_COLORS } from "./types";

/** Generate HSL color from PRNG — saturation 40-79, lightness 35-64 */
export function generateHSL(rand: () => number): {
  h: number;
  s: number;
  l: number;
} {
  return {
    h: Math.floor(rand() * 360),
    s: 40 + Math.floor(rand() * 40),
    l: 35 + Math.floor(rand() * 30),
  };
}

/** Convert HSL to 0xRRGGBB number */
export function hslToHex(h: number, s: number, l: number): number {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);

  return (ri << 16) | (gi << 8) | bi;
}

/** Convert HSL to "#RRGGBB" string */
export function hslToHexStr(h: number, s: number, l: number): string {
  const hex = hslToHex(h, s, l);
  return `#${hex.toString(16).padStart(6, "0").toUpperCase()}`;
}

/** Generate a color as 0xRRGGBB from PRNG */
export function generateColorHex(rand: () => number): number {
  const { h, s, l } = generateHSL(rand);
  return hslToHex(h, s, l);
}

/** Build a color map from marker colors to replacement hex strings */
export function buildColorMap(colors: number[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < colors.length && i < MARKER_COLORS.length; i++) {
    const marker = MARKER_COLORS[i] as string;
    const color = colors[i]!;
    map[marker] = `#${color.toString(16).padStart(6, "0").toUpperCase()}`;
  }
  return map;
}

/** Fetch SVG, replace marker colors, return PixiJS Texture */
export async function swapPalette(
  svgUrl: string,
  colorMap: Record<string, string>,
): Promise<Texture> {
  let svg = await fetch(svgUrl).then((r) => r.text());

  for (const [marker, replacement] of Object.entries(colorMap)) {
    svg = svg.replaceAll(marker, replacement);
  }

  const blob = new Blob([svg], { type: "image/svg+xml" });
  const objectUrl = URL.createObjectURL(blob);
  const texture = await Assets.load(objectUrl);
  URL.revokeObjectURL(objectUrl);

  return texture;
}
