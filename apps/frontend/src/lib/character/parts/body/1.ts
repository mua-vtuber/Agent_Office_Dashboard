import type { PartDrawFn } from "../../types";

/** Chubby body type */
const draw: PartDrawFn = (g, colors) => {
  g.circle(0, -2, 6).fill(colors[0]); // head
  g.roundRect(-5, 4, 10, 11, 3).fill(colors[0]); // torso
  g.roundRect(-5, 15, 4, 5, 1).fill(colors[0]); // left leg
  g.roundRect(1, 15, 4, 5, 1).fill(colors[0]); // right leg
};

export default draw;
