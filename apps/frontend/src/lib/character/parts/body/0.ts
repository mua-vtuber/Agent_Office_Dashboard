import type { PartDrawFn } from "../../types";

/** Basic body type */
const draw: PartDrawFn = (g, colors) => {
  g.circle(0, -2, 5).fill(colors[0]); // head
  g.roundRect(-4, 4, 8, 10, 2).fill(colors[0]); // torso
  g.roundRect(-5, 14, 4, 6, 1).fill(colors[0]); // left leg
  g.roundRect(1, 14, 4, 6, 1).fill(colors[0]); // right leg
};

export default draw;
