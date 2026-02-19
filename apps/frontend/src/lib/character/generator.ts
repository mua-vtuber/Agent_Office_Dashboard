import type { CharacterTraits } from "./types";
import { generateColorHex, generatePastelSkinHex } from "./palette";

/** Hash agent_id string to unsigned 32-bit integer seed */
export function hashSeed(agentId: string): number {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) {
    h = (Math.imul(31, h) + agentId.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Mulberry32 deterministic PRNG — returns [0, 1) */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate deterministic character traits from agent_id */
export function generateTraits(
  agentId: string,
  partCounts: { body: number; hair: number; costume: number; accessory: number },
): CharacterTraits {
  const rand = mulberry32(hashSeed(agentId));

  // PRNG consumption order: body → hair → costume → accessory → skinColor → hairColor → costumeColors(4) → accessoryColors(4)
  const bodyIndex = Math.floor(rand() * partCounts.body);
  const hairIndex = Math.floor(rand() * partCounts.hair);
  const costumeIndex = Math.floor(rand() * partCounts.costume);
  // accessoryIndex: -1 means no accessory
  const accessoryIndex = Math.floor(rand() * (partCounts.accessory + 1)) - 1;

  const skinColor = generatePastelSkinHex(rand);
  const hairColor = generateColorHex(rand);

  const costumeColors: number[] = [];
  for (let i = 0; i < 4; i++) costumeColors.push(generateColorHex(rand));

  const accessoryColors: number[] = [];
  for (let i = 0; i < 4; i++) accessoryColors.push(generateColorHex(rand));

  return {
    bodyIndex,
    hairIndex,
    costumeIndex,
    accessoryIndex,
    skinColor,
    hairColor,
    costumeColors,
    accessoryColors,
  };
}
