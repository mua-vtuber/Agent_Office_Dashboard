import type { PartDrawFn } from "../../types";

/** Spiky hair */
const draw: PartDrawFn = (g, colors) => {
  g.moveTo(0, -10).lineTo(-5, -2).lineTo(5, -2).closePath().fill(colors[0]); // triangle spike
};

export default draw;
