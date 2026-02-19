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

/**
 * Illustrator exports colors as CSS names ("red") or shorthand hex ("#f00")
 * instead of full hex ("#FF0000"). Normalize to canonical marker format
 * so swapPalette can find and replace them.
 */
const COLOR_ALIASES: Record<string, string> = {
  // CSS names → canonical hex (matching MARKER_COLORS)
  red: "#FF0000",
  lime: "#00FF00",
  blue: "#0000FF",
  yellow: "#FFFF00",
  // shorthand hex
  "#f00": "#FF0000",
  "#0f0": "#00FF00",
  "#00f": "#0000FF",
  "#ff0": "#FFFF00",
};

function normalizeSvgColors(svg: string): string {
  // Replace fill="red" / fill:#f00; / fill:"red" patterns
  return svg.replace(
    /(?<=fill\s*[:=]\s*"?)([a-z]+|#[0-9a-f]{3})(?="|\s*;)/gi,
    (match) => COLOR_ALIASES[match.toLowerCase()] ?? match,
  );
}

/** Fetch SVG, replace marker colors, return PixiJS Texture */
export async function swapPalette(
  svgUrl: string,
  colorMap: Record<string, string>,
): Promise<Texture> {
  const resp = await fetch(svgUrl);
  if (!resp.ok) throw new Error(`Failed to fetch SVG: ${resp.status} ${svgUrl}`);
  let svg = await resp.text();

  svg = normalizeSvgColors(svg);

  for (const [marker, replacement] of Object.entries(colorMap)) {
    svg = svg.replaceAll(marker, replacement);
  }

  // Load SVG as data URI to avoid blob URL revocation race
  const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const texture = await Assets.load(dataUri);

  return texture;
}
