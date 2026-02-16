import type { PartDrawFn } from "../../types";

/** Long hair */
const draw: PartDrawFn = (g, colors) => {
  g.ellipse(0, -5, 6, 3).fill(colors[0]); // top cap
  g.rect(-6, -4, 2, 10).fill(colors[0]); // left side
  g.rect(4, -4, 2, 10).fill(colors[0]); // right side
};

export default draw;
