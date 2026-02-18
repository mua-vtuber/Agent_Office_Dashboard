/* Canvas constants — shared coordinate system for all parts */
export const CHAR_W = 100;
export const CHAR_H = 100;
export const ORIGIN_X = CHAR_W / 2; // 20
export const ORIGIN_Y = CHAR_H / 2; // 20

/* Character traits determined from seed */
export interface CharacterTraits {
  bodyIndex: number;
  hairIndex: number;
  costumeIndex: number;
  accessoryIndex: number; // -1 = none
  skinColor: number; // 0xRRGGBB
  hairColor: number;
  costumeColors: number[]; // [zone1, zone2, zone3, zone4]
  accessoryColors: number[];
}

/* SVG marker color conventions */
export const MARKER_COLORS = [
  "#FF0000", // zone 1
  "#00FF00", // zone 2
  "#0000FF", // zone 3
  "#FFFF00", // zone 4
] as const;
