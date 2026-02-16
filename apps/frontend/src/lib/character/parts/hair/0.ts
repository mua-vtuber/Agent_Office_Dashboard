import type { PartDrawFn } from "../../types";

/** Short hair */
const draw: PartDrawFn = (g, colors) => {
  g.ellipse(0, -5, 6, 3).fill(colors[0]); // top cap
};

export default draw;
