/**
 * layout-engine.ts — Dynamic cluster layout for multi-team office visualization.
 *
 * Given a list of active terminal IDs, generates an office layout with
 * one cluster per terminal, arranged in a grid (max 2 columns).
 *
 * Each cluster follows a Korean-style office pattern:
 *   - Manager desk (wide, top) with manager seat above it
 *   - 4 rows × 2 columns of worker desks below, seats on the outer sides
 */

import type { Desk } from "@aod/shared-schema";

/* ---------- Public types ---------- */

export type Point = { x: number; y: number };
export type Bounds = { x_min: number; x_max: number; y_min: number; y_max: number };

export type ClusterLayout = {
  terminalId: string;
  /** Cluster bounding box (percent) */
  bounds: Bounds;
  /** Manager seat position (percent) */
  managerSeat: Point;
  /** Worker seat positions (percent), up to 8 */
  workerSeats: Point[];
  /** All desks within this cluster */
  desks: Desk[];
};

export type OfficeLayout = {
  canvasWidth: number;
  canvasHeight: number;
  /** Canvas height as a percentage (100% = 650px base) */
  canvasHeightPct: number;
  clusters: ClusterLayout[];
  allDesks: Desk[];
  zones: {
    pantryZone: Bounds;
    roamZone: Bounds;
  };
  /** Map terminal_session_id → cluster index */
  terminalToCluster: Map<string, number>;
  /** Partition line X position (percent) */
  partitionX: number;
  /** Partition height (percent) */
  partitionH: number;
  /** Door position (percent) */
  doorPct: Point;
};

/* ---------- Layout constants (percent-based) ---------- */

/** Work area occupies 3%..73% of canvas width */
const WORK_X_START = 3;
const WORK_X_END = 73;
const WORK_AREA_W = WORK_X_END - WORK_X_START; // 70%

/** Pantry area: 76%..100% */
const PANTRY_X_START = 76;

/** Max columns of clusters */
const MAX_COLS = 2;

/** Cluster sizing */
const CLUSTER_GAP_X = 4; // gap between columns (%)
const CLUSTER_GAP_Y = 4; // gap between rows (%)
const Y_START = 14; // top padding (%) — space below cabinets
const BOTTOM_MARGIN = 6; // bottom padding (%)

/**
 * Desk dimensions — pixel-based targets, then converted to percent.
 * Canvas is 1080×650, so 1% horizontal = 10.8px, 1% vertical = 6.5px.
 * Keeping 1:2 pixel ratio but ~60% of previous size.
 * Worker desk: ~38px wide × 76px tall
 * Manager desk: ~76px wide × 38px tall (rotated 90°)
 */
const DESK_W_PCT = 4.2;   // 4.2% of 1080 = 45px
const DESK_H_PCT = 12;    // 12% of 650 = 78px

const MGR_DESK_W_PCT = 7;   // 7% of 1080 = 76px
const MGR_DESK_H_PCT = 7;   // 7% of 650 = 45px

/** Rows of worker desks per cluster */
const WORKER_ROWS = 4;

/** Seat offset from desk edge */
const SEAT_OFFSET = 2;

/** Gap between manager desk and first worker row */
const MGR_WORKER_GAP = 0;

/** Manager seat sits above manager desk */
const MGR_SEAT_ABOVE = 3;

/* ---------- Core function ---------- */

export function generateOfficeLayout(terminalIds: string[]): OfficeLayout {
  const termCount = Math.max(1, terminalIds.length);
  const cols = Math.min(MAX_COLS, termCount);
  const rows = Math.ceil(termCount / cols);

  // Compute cluster width based on available work area
  const totalGapX = (cols - 1) * CLUSTER_GAP_X;
  const clusterW = (WORK_AREA_W - totalGapX) / cols;

  // Compute cluster height
  const mgrAreaH = MGR_DESK_H_PCT + MGR_SEAT_ABOVE;
  const workerAreaH = WORKER_ROWS * DESK_H_PCT; // no gap between rows — desks touch
  const clusterH = mgrAreaH + MGR_WORKER_GAP + workerAreaH;

  // Canvas height
  const totalGapY = (rows - 1) * CLUSTER_GAP_Y;
  const contentH = Y_START + rows * clusterH + totalGapY + BOTTOM_MARGIN;
  const canvasHeightPct = Math.max(100, contentH); // 100% = 650px minimum
  const canvasHeight = Math.max(650, Math.round((canvasHeightPct / 100) * 650));
  const canvasWidth = 1080;

  const clusters: ClusterLayout[] = [];
  const allDesks: Desk[] = [];
  const terminalToCluster = new Map<string, number>();

  for (let i = 0; i < termCount; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);

    const clusterX = WORK_X_START + col * (clusterW + CLUSTER_GAP_X);
    const clusterY = Y_START + row * (clusterH + CLUSTER_GAP_Y);

    const termId = terminalIds[i] ?? `_default_${i}`;
    terminalToCluster.set(termId, i);

    const cluster = buildCluster(termId, clusterX, clusterY, clusterW, clusterH, i);
    clusters.push(cluster);
    allDesks.push(...cluster.desks);
  }

  // Partition and pantry scale to canvas height, capped at 99%
  const partitionH = Math.min(99, Math.max(82, canvasHeightPct - 18));

  // Zones
  const pantryZone: Bounds = {
    x_min: PANTRY_X_START,
    x_max: 100,
    y_min: 0,
    y_max: 100,
  };

  const roamZone: Bounds = {
    x_min: WORK_X_START,
    x_max: WORK_X_END,
    y_min: Y_START,
    y_max: Math.min(95, Y_START + rows * clusterH + totalGapY + 5),
  };

  return {
    canvasWidth,
    canvasHeight,
    canvasHeightPct,
    clusters,
    allDesks,
    zones: { pantryZone, roamZone },
    terminalToCluster,
    partitionX: 74,
    partitionH,
    doorPct: { x: 8, y: 99 },
  };
}

/* ---------- Single cluster builder ---------- */

function buildCluster(
  terminalId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  index: number,
): ClusterLayout {
  const desks: Desk[] = [];
  const workerSeats: Point[] = [];

  // Center X of cluster
  const cx = x + w / 2;

  // All desks use the same uniform size (DESK_W_PCT × DESK_H_PCT)
  // Worker desk block: 2 columns touching side-by-side, no gap
  const deskPairW = DESK_W_PCT * 2; // no gap between left & right
  const deskStartX = cx - deskPairW / 2;

  // Manager desk — rotated 90° (horizontal), centered at top of cluster
  const mgrDeskX = cx - MGR_DESK_W_PCT / 2;
  const mgrDeskY = y + MGR_SEAT_ABOVE;
  desks.push({
    id: `c${index}_desk_mgr`,
    x_min: round2(mgrDeskX),
    x_max: round2(mgrDeskX + MGR_DESK_W_PCT),
    y_min: round2(mgrDeskY),
    y_max: round2(mgrDeskY + MGR_DESK_H_PCT),
  });

  // Manager seat — above manager desk
  const managerSeat: Point = {
    x: round2(cx),
    y: round2(mgrDeskY - SEAT_OFFSET),
  };

  // Worker desks: 2 columns, 4 rows, touching with no gaps
  const deskStartY = mgrDeskY + MGR_DESK_H_PCT + MGR_WORKER_GAP;

  for (let row = 0; row < WORKER_ROWS; row++) {
    const deskY = deskStartY + row * DESK_H_PCT; // no row gap — desks touch

    // Left desk
    const leftDeskX = deskStartX;
    desks.push({
      id: `c${index}_desk_${row}_L`,
      x_min: round2(leftDeskX),
      x_max: round2(leftDeskX + DESK_W_PCT),
      y_min: round2(deskY),
      y_max: round2(deskY + DESK_H_PCT),
    });

    // Right desk — immediately adjacent, no gap
    const rightDeskX = deskStartX + DESK_W_PCT;
    desks.push({
      id: `c${index}_desk_${row}_R`,
      x_min: round2(rightDeskX),
      x_max: round2(rightDeskX + DESK_W_PCT),
      y_min: round2(deskY),
      y_max: round2(deskY + DESK_H_PCT),
    });

    // Left seat — sits to the left of left desk, upper third for 2-head-tall characters
    workerSeats.push({
      x: round2(leftDeskX - SEAT_OFFSET),
      y: round2(deskY + DESK_H_PCT * 0.3),
    });

    // Right seat — sits to the right of right desk
    workerSeats.push({
      x: round2(rightDeskX + DESK_W_PCT + SEAT_OFFSET),
      y: round2(deskY + DESK_H_PCT * 0.3),
    });
  }

  const bounds: Bounds = {
    x_min: round2(x),
    x_max: round2(x + w),
    y_min: round2(y),
    y_max: round2(y + h),
  };

  return { terminalId, bounds, managerSeat, workerSeats, desks };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
