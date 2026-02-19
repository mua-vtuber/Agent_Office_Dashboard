/**
 * pathfinding.ts — A* grid-based pathfinding for agent movement.
 *
 * Uses a collision grid in percentage coordinates (2% resolution).
 * Solid objects (desks, partitions) are marked as blocked cells.
 * Agents compute paths when their target changes, then follow waypoints.
 */

import type { Desk } from "@aod/shared-schema";

export type Point = { x: number; y: number };

/* ---------- Grid ---------- */

/** Grid cell resolution in percent (2% per cell) */
const GRID_RES = 2;
const MAX_GRID_X = Math.ceil(100 / GRID_RES); // 50
const MAX_GRID_Y_DEFAULT = Math.ceil(100 / GRID_RES); // 50

export type Grid = {
  width: number;
  height: number;
  blocked: boolean[];
};

/** Obstacle definition in percent coordinates */
export type Obstacle = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Build a collision grid from desk bounds and extra obstacles.
 * canvasHeightPct: the canvas height as a percentage (100 = 650px default).
 */
export function buildCollisionGrid(
  desks: Desk[],
  obstacles: Obstacle[],
  canvasHeightPct: number = 100,
): Grid {
  const gridW = MAX_GRID_X;
  const gridH = Math.ceil(canvasHeightPct / GRID_RES);
  const blocked = new Array<boolean>(gridW * gridH).fill(false);

  function markRect(xMin: number, yMin: number, xMax: number, yMax: number): void {
    // Add a small margin (half a cell) for agent clearance
    const margin = 0.5;
    const gx0 = Math.max(0, Math.floor((xMin - margin) / GRID_RES));
    const gy0 = Math.max(0, Math.floor((yMin - margin) / GRID_RES));
    const gx1 = Math.min(gridW - 1, Math.ceil((xMax + margin) / GRID_RES));
    const gy1 = Math.min(gridH - 1, Math.ceil((yMax + margin) / GRID_RES));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        blocked[gy * gridW + gx] = true;
      }
    }
  }

  // Mark desks
  for (const d of desks) {
    markRect(d.x_min, d.y_min, d.x_max, d.y_max);
  }

  // Mark extra obstacles (partitions, walls, etc.)
  for (const o of obstacles) {
    markRect(o.x, o.y, o.x + o.w, o.y + o.h);
  }

  return { width: gridW, height: gridH, blocked };
}

/* ---------- A* ---------- */

type AStarNode = {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent: AStarNode | null;
};

/** 8-directional neighbor offsets */
const DIRS: [number, number, number][] = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [1, 1, 1.414],
];

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  // Octile distance (consistent for 8-directional)
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
}

/**
 * Find a path from start to end on the collision grid.
 * Returns an array of waypoints in percentage coordinates.
 * Returns null if no path is found.
 */
export function findPath(grid: Grid, start: Point, end: Point): Point[] | null {
  const sx = Math.round(start.x / GRID_RES);
  const sy = Math.round(start.y / GRID_RES);
  const ex = Math.round(end.x / GRID_RES);
  const ey = Math.round(end.y / GRID_RES);

  // Clamp to grid bounds
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  const startGx = clamp(sx, grid.width);
  const startGy = clamp(sy, grid.height);
  const endGx = clamp(ex, grid.width);
  const endGy = clamp(ey, grid.height);

  // If start or end is blocked, find nearest unblocked cell
  const resolvedStart = unblockNearest(grid, startGx, startGy);
  const resolvedEnd = unblockNearest(grid, endGx, endGy);

  if (!resolvedStart || !resolvedEnd) {
    // Fallback: direct line
    return [start, end];
  }

  if (resolvedStart.x === resolvedEnd.x && resolvedStart.y === resolvedEnd.y) {
    return [end];
  }

  // A* open/closed sets
  const open: AStarNode[] = [];
  const closedSet = new Set<number>();
  const gScores = new Map<number, number>();

  const key = (x: number, y: number) => y * grid.width + x;

  const startNode: AStarNode = {
    x: resolvedStart.x,
    y: resolvedStart.y,
    g: 0,
    h: heuristic(resolvedStart.x, resolvedStart.y, resolvedEnd.x, resolvedEnd.y),
    f: 0,
    parent: null,
  };
  startNode.f = startNode.g + startNode.h;
  open.push(startNode);
  gScores.set(key(startNode.x, startNode.y), 0);

  let iterations = 0;
  const maxIterations = grid.width * grid.height * 2;

  while (open.length > 0 && iterations < maxIterations) {
    iterations++;

    // Find node with lowest f in open list
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestIdx]!.f) bestIdx = i;
    }
    const current = open[bestIdx]!;
    open.splice(bestIdx, 1);

    if (current.x === resolvedEnd.x && current.y === resolvedEnd.y) {
      return reconstructPath(current, start, end);
    }

    const ck = key(current.x, current.y);
    if (closedSet.has(ck)) continue;
    closedSet.add(ck);

    for (const dir of DIRS) {
      const [ddx, ddy, cost] = dir;
      const nx = current.x + ddx;
      const ny = current.y + ddy;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;

      const nk = key(nx, ny);
      if (closedSet.has(nk)) continue;
      if (grid.blocked[nk]) continue;

      // For diagonal moves, check that both adjacent cells are free (prevent corner cutting)
      if (ddx !== 0 && ddy !== 0) {
        if (grid.blocked[key(current.x + ddx, current.y)] || grid.blocked[key(current.x, current.y + ddy)]) {
          continue;
        }
      }

      const ng = current.g + cost;
      const prevG = gScores.get(nk);
      if (prevG !== undefined && ng >= prevG) continue;

      gScores.set(nk, ng);
      const nh = heuristic(nx, ny, resolvedEnd.x, resolvedEnd.y);
      open.push({
        x: nx,
        y: ny,
        g: ng,
        h: nh,
        f: ng + nh,
        parent: current,
      });
    }
  }

  // No path found — fallback direct
  return [start, end];
}

function reconstructPath(node: AStarNode, originalStart: Point, originalEnd: Point): Point[] {
  const gridPath: AStarNode[] = [];
  let cur: AStarNode | null = node;
  while (cur !== null) {
    gridPath.push(cur);
    cur = cur.parent;
  }
  gridPath.reverse();

  // Convert grid coords back to percent coords
  const path: Point[] = [originalStart];
  for (const gn of gridPath) {
    path.push({
      x: gn.x * GRID_RES,
      y: gn.y * GRID_RES,
    });
  }
  path.push(originalEnd);

  // Simplify path: remove collinear points
  return simplifyPath(path);
}

function simplifyPath(path: Point[]): Point[] {
  if (path.length <= 2) return path;
  const first = path[0]!;
  const result: Point[] = [first];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = result[result.length - 1]!;
    const cur = path[i]!;
    const next = path[i + 1]!;

    // Check if direction changes
    const dx1 = cur.x - prev.x;
    const dy1 = cur.y - prev.y;
    const dx2 = next.x - cur.x;
    const dy2 = next.y - cur.y;

    // Keep point if direction changes (not collinear)
    if (Math.abs(dx1 * dy2 - dy1 * dx2) > 0.001) {
      result.push(cur);
    }
  }

  result.push(path[path.length - 1]!);
  return result;
}

/** Find nearest unblocked cell via BFS */
function unblockNearest(grid: Grid, gx: number, gy: number): { x: number; y: number } | null {
  if (!grid.blocked[gy * grid.width + gx]) return { x: gx, y: gy };

  const visited = new Set<number>();
  const queue: [number, number][] = [[gx, gy]];
  visited.add(gy * grid.width + gx);

  while (queue.length > 0) {
    const [cx, cy] = queue.shift()!;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= grid.width || ny < 0 || ny >= grid.height) continue;
      const nk = ny * grid.width + nx;
      if (visited.has(nk)) continue;
      visited.add(nk);
      if (!grid.blocked[nk]) return { x: nx, y: ny };
      queue.push([nx, ny]);
    }
  }

  return null;
}
