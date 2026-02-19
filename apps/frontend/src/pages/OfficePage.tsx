import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text } from "pixi.js";
import type { Desk } from "@aod/shared-schema";
import { apiGet } from "../lib/api";
import { useAgentStore, type AgentView } from "../stores/agent-store";
import { useAppSettingsStore } from "../stores/app-settings-store";
import { useErrorStore } from "../stores/error-store";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildCharacter } from "../lib/character/builder";
import { generateOfficeLayout, type OfficeLayout, type Point, type Bounds, type ClusterLayout } from "../lib/layout-engine";
import { buildCollisionGrid, findPath, type Grid, type Obstacle } from "../lib/pathfinding";

/* ---------- Office SVG assets ---------- */
import cabinetSvg from "../assets/office/cabinet.svg";
import partitionVSvg from "../assets/office/partition-v.svg";
import wallSvg from "../assets/office/wall.svg";
import doorSvg from "../assets/office/door.svg";
import fridgeSvg from "../assets/office/fridge.svg";
import microwaveSvg from "../assets/office/microwave.svg";
import sinkSvg from "../assets/office/sink.svg";
import stoveSvg from "../assets/office/stove.svg";
import tablePantrySvg from "../assets/office/table-pantry.svg";
import counterSvg from "../assets/office/counter.svg";
import clockSvg from "../assets/office/clock.svg";
import deskSingleSvg from "../assets/office/desk-single.svg";

const AGENT_R = 50;
const DEFAULT_MOVE_SPEED = 120;

/* ---------- Types ---------- */

type RecentEvent = { id: string; ts: string; type: string; agent_id: string };

/* ---------- Helpers ---------- */

function pxX(pct: number, canvasWidth: number): number { return (pct / 100) * canvasWidth; }
function pxY(pct: number, canvasHeight: number): number { return (pct / 100) * canvasHeight; }

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function isInsideDesk(p: Point, desks: Desk[]): boolean {
  return desks.some((d) => p.x >= d.x_min && p.x <= d.x_max && p.y >= d.y_min && p.y <= d.y_max);
}

function pickInZone(zone: Bounds, seed: number, desks: Desk[] = []): Point {
  for (let i = 0; i < 10; i++) {
    const s = seed + i * 7919;
    const rx = ((s % 1000) / 1000) * (zone.x_max - zone.x_min) + zone.x_min;
    const ry = (((s >> 3) % 1000) / 1000) * (zone.y_max - zone.y_min) + zone.y_min;
    const pt = { x: Number(rx.toFixed(2)), y: Number(ry.toFixed(2)) };
    if (!isInsideDesk(pt, desks)) return pt;
  }
  return {
    x: Number(((zone.x_min + zone.x_max) / 2).toFixed(2)),
    y: Number(((zone.y_min + zone.y_max) / 2).toFixed(2)),
  };
}

function isManager(id: string): boolean { return id.endsWith("/leader"); }

function isSeatStatus(status: string): boolean {
  return status === "working" || status === "idle" || status === "pending_input"
    || status === "failed" || status === "meeting" || status === "handoff"
    || status === "returning" || status === "resting";
}

function statusColor(s: string): number {
  switch (s) {
    case "working": return 0x4caf50;
    case "failed": return 0xf44336;
    case "pending_input": return 0xff9800;
    case "meeting": case "handoff": case "returning": return 0x2196f3;
    case "breakroom": return 0x9c27b0;
    case "roaming": case "completed": return 0x00bcd4;
    case "resting": return 0x607d8b;
    case "offline": return 0x424242;
    default: return 0x78909c;
  }
}

function effectLabel(s: string): string {
  if (s === "failed") return "!";
  if (s === "pending_input") return "...";
  if (s === "resting") return "Zzz";
  return "";
}

type ThoughtBubbleConfig = { enabled: boolean; max_length: number };

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

function resolveBubbleText(thinking: string | null, status: string, config: ThoughtBubbleConfig): string {
  if (config.enabled && thinking) {
    return truncateText(thinking, config.max_length);
  }
  if (status === "working") return "Working...";
  if (status === "meeting") return "Meeting...";
  return "";
}

/* ---------- Agent target computation ---------- */

function computeTargets(
  agents: AgentView[],
  layout: OfficeLayout,
  roamTick: number,
): Record<string, Point> {
  const result: Record<string, Point> = {};

  const byTerminal = new Map<string, AgentView[]>();
  for (const a of agents) {
    const tid = a.terminal_session_id || "_unassigned";
    const arr = byTerminal.get(tid) ?? [];
    arr.push(a);
    byTerminal.set(tid, arr);
  }

  for (const [termId, termAgents] of byTerminal) {
    const clusterIdx = layout.terminalToCluster.get(termId);
    const cluster: ClusterLayout | undefined = clusterIdx !== undefined ? layout.clusters[clusterIdx] : undefined;

    const workers = termAgents
      .filter((a) => !isManager(a.agent_id))
      .sort((a, b) => a.agent_id.localeCompare(b.agent_id));

    for (const agent of termAgents) {
      const s = agent.status;

      if (isSeatStatus(s) && cluster) {
        if (isManager(agent.agent_id)) {
          result[agent.agent_id] = cluster.managerSeat;
        } else {
          const wIdx = workers.indexOf(agent);
          const seat = cluster.workerSeats[wIdx % cluster.workerSeats.length];
          if (seat) {
            const overflow = Math.floor(wIdx / cluster.workerSeats.length);
            if (overflow === 0) {
              result[agent.agent_id] = seat;
            } else {
              const seed = hashSeed(agent.agent_id);
              const angle = ((seed % 360) * Math.PI) / 180;
              const radius = 1.5 + overflow * 1.2;
              result[agent.agent_id] = {
                x: seat.x + Math.cos(angle) * radius,
                y: seat.y + Math.sin(angle) * radius,
              };
            }
          } else {
            result[agent.agent_id] = cluster.managerSeat;
          }
        }
      } else if (s === "breakroom" || s === "offline") {
        result[agent.agent_id] = pickInZone(
          layout.zones.pantryZone,
          hashSeed(`${agent.agent_id}-pantry`),
          layout.allDesks,
        );
      } else if (s === "roaming" || s === "completed") {
        const seed = hashSeed(`${agent.agent_id}-roam-${roamTick}`);
        const zone = (seed % 10) < 7 ? layout.zones.pantryZone : layout.zones.roamZone;
        result[agent.agent_id] = pickInZone(zone, seed, layout.allDesks);
      } else {
        result[agent.agent_id] = pickInZone(
          layout.zones.pantryZone,
          hashSeed(`${agent.agent_id}-default`),
          layout.allDesks,
        );
      }
    }
  }

  return result;
}

/* ---------- Agent PixiJS node ---------- */

type AgentNode = {
  root: Container;
  body: Container;
  nameText: Text;
  effectText: Text;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleTxt: Text;
  musicNote: Text;
  cur: Point;
  tgt: Point;
  path: Point[];
  pathIndex: number;
  status: string;
  thinking: string | null;
  phase: "entering" | "active" | "exiting";
  musicTime: number;
};

function createNode(agent: AgentView, pos: Point, tbConfig: ThoughtBubbleConfig): AgentNode {
  const root = new Container();
  root.x = pos.x;
  root.y = pos.y;

  const fallback = new Container();
  const fallbackGfx = new Graphics();
  fallbackGfx.circle(0, 0, AGENT_R).fill(statusColor(agent.status));
  fallback.addChild(fallbackGfx);
  root.addChild(fallback);

  const shortName = (agent.agent_id.split("/").at(-1) ?? agent.agent_id).slice(0, 10);
  const nameText = new Text({ text: shortName, style: { fontSize: 13, fill: "#333333", fontFamily: "sans-serif", fontWeight: "bold" } });
  nameText.anchor.set(0.5, 1);
  nameText.y = -(AGENT_R * 0.55);
  root.addChild(nameText);

  const effectText = new Text({
    text: effectLabel(agent.status),
    style: { fontSize: 13, fill: "#e53935", fontFamily: "sans-serif", fontWeight: "bold" },
  });
  effectText.anchor.set(0.5, 1);
  effectText.y = -(AGENT_R * 0.55 + 15);
  root.addChild(effectText);

  const musicNote = new Text({
    text: "\u266A",
    style: { fontSize: 14, fill: "#00bcd4", fontFamily: "sans-serif" },
  });
  musicNote.anchor.set(0.5, 0.5);
  musicNote.x = AGENT_R + 8;
  musicNote.y = -(AGENT_R / 2);
  musicNote.visible = agent.status === "roaming" || agent.status === "completed";
  root.addChild(musicNote);

  const bubble = new Container();
  const bubbleBg = new Graphics();
  const bubbleTxt = new Text({ text: "", style: { fontSize: 8, fill: "#333333", fontFamily: "sans-serif" } });
  bubbleTxt.anchor.set(0.5, 0.5);
  bubble.addChild(bubbleBg);
  bubble.addChild(bubbleTxt);
  root.addChild(bubble);
  applyBubble(bubble, bubbleBg, bubbleTxt, agent.thinking, agent.status, tbConfig);

  const node: AgentNode = {
    root, body: fallback, nameText, effectText, bubble, bubbleBg, bubbleTxt,
    musicNote,
    cur: { ...pos }, tgt: { ...pos },
    path: [], pathIndex: 0,
    status: agent.status, thinking: agent.thinking,
    phase: "entering",
    musicTime: 0,
  };

  buildCharacter(agent.agent_id, AGENT_R * 2).then((charContainer) => {
    if (root.destroyed) return;
    const idx = root.getChildIndex(fallback);
    root.removeChild(fallback);
    fallback.destroy({ children: true });
    root.addChildAt(charContainer, idx);
    node.body = charContainer;
  }).catch((err) => {
    console.warn(`[AOD] Failed to build character for ${agent.agent_id}:`, err);
  });

  return node;
}

function applyBubble(container: Container, bg: Graphics, txt: Text, thinking: string | null, status: string, tbConfig: ThoughtBubbleConfig): void {
  const label = resolveBubbleText(thinking, status, tbConfig);
  if (!label) { container.visible = false; return; }
  container.visible = true;
  txt.text = label;
  const isThought = tbConfig.enabled && !!thinking;
  const pad = 6;
  const w = Math.min(140, Math.max(48, txt.width + pad * 2));
  const h = isThought ? Math.max(18, Math.min(36, txt.height + pad * 2)) : 16;
  txt.style.wordWrap = isThought;
  txt.style.wordWrapWidth = w - pad * 2;
  bg.clear();

  if (isThought) {
    bg.roundRect(-w / 2, 0, w, h, 6)
      .fill({ color: 0xf0f4ff, alpha: 0.95 })
      .stroke({ color: 0x9999cc, width: 1 });
    bg.circle(-4, h + 4, 3).fill({ color: 0xf0f4ff, alpha: 0.9 }).stroke({ color: 0x9999cc, width: 0.5 });
    bg.circle(-1, h + 10, 2).fill({ color: 0xf0f4ff, alpha: 0.8 }).stroke({ color: 0x9999cc, width: 0.5 });
  } else {
    bg.roundRect(-w / 2, 0, w, h, 4)
      .fill({ color: 0xffffff, alpha: 0.92 })
      .stroke({ color: 0xbbbbbb, width: 1 });
  }

  txt.x = 0;
  txt.y = h / 2;
  container.y = -(AGENT_R + 8 + h);
}

function refreshNode(node: AgentNode, agent: AgentView, tbConfig: ThoughtBubbleConfig): void {
  node.effectText.text = effectLabel(agent.status);
  applyBubble(node.bubble, node.bubbleBg, node.bubbleTxt, agent.thinking, agent.status, tbConfig);
  node.musicNote.visible = agent.status === "roaming" || agent.status === "completed";
  node.status = agent.status;
  node.thinking = agent.thinking;
}

/* ---------- Static scene (dynamic layout-aware) ---------- */

function drawBounds(bg: Graphics, bounds: Bounds, cw: number, ch: number, fillColor: number, alpha: number): void {
  const x = pxX(bounds.x_min, cw);
  const y = pxY(bounds.y_min, ch);
  const w = pxX(bounds.x_max - bounds.x_min, cw);
  const h = pxY(bounds.y_max - bounds.y_min, ch);
  bg.rect(x, y, w, h).fill({ color: fillColor, alpha });
}

/**
 * Object placement descriptor.
 * `fixedH: true` means the object's Y position and height are calculated
 * against the base height (650px) instead of the actual canvas height.
 * This keeps pantry objects, cabinets, etc. from stretching when canvas grows.
 */
type ObjPlace = { url: string; xPct: number; yPct: number; wPct: number; hPct: number; fixedH?: boolean };

/** Base canvas height (the reference for fixed-height objects) */
const BASE_CANVAS_H = 650;

function buildObjectPlacements(layout: OfficeLayout): ObjPlace[] {
  const placements: ObjPlace[] = [];

  /* Wall stretches to full canvas */
  placements.push({ url: wallSvg, xPct: 0, yPct: 0, wPct: 100, hPct: 100 });

  /* Cabinets — fixed size, pinned to top */
  const cabinetY = 0.5;
  const cabinetH = 5;
  const cabinetW = 9;
  const cabinetPositions = [28, 38, 48, 58];
  for (const cx of cabinetPositions) {
    placements.push({ url: cabinetSvg, xPct: cx, yPct: cabinetY, wPct: cabinetW, hPct: cabinetH, fixedH: true });
  }

  /* Desks from layout engine — these are already in correct % coords */
  for (const desk of layout.allDesks) {
    placements.push({
      url: deskSingleSvg,
      xPct: desk.x_min,
      yPct: desk.y_min,
      wPct: desk.x_max - desk.x_min,
      hPct: desk.y_max - desk.y_min,
    });
  }

  /* Partition — stretches to full canvas height (intentional) */
  placements.push({ url: partitionVSvg, xPct: layout.partitionX, yPct: 1, wPct: 1.5, hPct: layout.partitionH });

  /* Door — pinned to bottom, fixed size */
  placements.push({ url: doorSvg, xPct: 5, yPct: 98, wPct: 7, hPct: 2 });

  /* Clock — fixed size, pinned to top */
  placements.push({ url: clockSvg, xPct: 3, yPct: 1, wPct: 4, hPct: 5, fixedH: true });

  /* Pantry objects — all fixed size, pinned to top/original position */
  placements.push({ url: tablePantrySvg, xPct: 77, yPct: 22, wPct: 5, hPct: 52, fixedH: true });
  placements.push({ url: fridgeSvg, xPct: 84, yPct: 1, wPct: 5, hPct: 7, fixedH: true });
  placements.push({ url: microwaveSvg, xPct: 90, yPct: 1, wPct: 4, hPct: 5, fixedH: true });
  placements.push({ url: sinkSvg, xPct: 95, yPct: 1, wPct: 4.5, hPct: 6, fixedH: true });
  placements.push({ url: stoveSvg, xPct: 95, yPct: 12, wPct: 4.5, hPct: 8, fixedH: true });
  placements.push({ url: counterSvg, xPct: 96, yPct: 22, wPct: 3.5, hPct: 55, fixedH: true });

  return placements;
}

async function loadSvgSprite(url: string, x: number, y: number, w: number, h: number): Promise<Sprite> {
  const texture = await Assets.load(url);
  const sprite = new Sprite(texture);
  sprite.x = x;
  sprite.y = y;
  sprite.width = w;
  sprite.height = h;
  return sprite;
}

function drawScene(stage: Container, layout: OfficeLayout): void {
  const cw = layout.canvasWidth;
  const ch = layout.canvasHeight;
  const bg = new Graphics();

  bg.rect(0, 0, cw, ch).fill(0xe8e0d8);

  const clusterColors = [0xd4c8b8, 0xc8bca8, 0xd0c4b4, 0xc4b8a4];
  for (let i = 0; i < layout.clusters.length; i++) {
    const cluster = layout.clusters[i]!;
    drawBounds(bg, cluster.bounds, cw, ch, clusterColors[i % clusterColors.length]!, 0.5);
  }

  drawBounds(bg, layout.zones.pantryZone, cw, ch, 0xb8d8c8, 0.5);
  stage.addChild(bg);

  const seats = new Graphics();
  for (const cluster of layout.clusters) {
    seats.circle(pxX(cluster.managerSeat.x, cw), pxY(cluster.managerSeat.y, ch), 4)
      .fill({ color: 0xcc7700, alpha: 0.3 });
    for (const ws of cluster.workerSeats) {
      seats.circle(pxX(ws.x, cw), pxY(ws.y, ch), 4)
        .fill({ color: 0x999999, alpha: 0.3 });
    }
  }
  stage.addChild(seats);

  const ls = { fontSize: 10, fill: "#888888", fontFamily: "sans-serif" };
  for (const cluster of layout.clusters) {
    const shortId = cluster.terminalId.startsWith("_default") ? `Team ${cluster.terminalId.split("_")[2] ?? ""}` : cluster.terminalId.slice(-8);
    const t = new Text({ text: shortId, style: ls });
    t.x = pxX(cluster.bounds.x_min + 1, cw);
    t.y = pxY(Math.max(0, cluster.bounds.y_min - 3), ch);
    t.alpha = 0.6;
    stage.addChild(t);
  }

  const pantryLabel = new Text({ text: "Pantry", style: ls });
  pantryLabel.x = pxX(layout.zones.pantryZone.x_min + 1, cw);
  pantryLabel.y = pxY(layout.zones.pantryZone.y_min + 5, ch);
  pantryLabel.alpha = 0.6;
  stage.addChild(pantryLabel);

  const objectContainer = new Container();
  stage.addChild(objectContainer);

  const placements = buildObjectPlacements(layout);
  for (const obj of placements) {
    const px = pxX(obj.xPct, cw);
    // For fixedH objects, use BASE_CANVAS_H for Y position and height
    const refH = obj.fixedH ? BASE_CANVAS_H : ch;
    const py = pxY(obj.yPct, refH);
    const pw = pxX(obj.wPct, cw);
    const ph = pxY(obj.hPct, refH);
    loadSvgSprite(obj.url, px, py, pw, ph)
      .then((sprite) => { objectContainer.addChild(sprite); })
      .catch((err) => { console.warn("[AOD] Failed to load office object:", obj.url, err); });
  }
}

/* ---------- Collision grid builder ---------- */

function buildGridForLayout(layout: OfficeLayout): Grid {
  const obstacles: Obstacle[] = [
    { x: layout.partitionX, y: 1, w: 1.5, h: layout.partitionH },
  ];
  return buildCollisionGrid(layout.allDesks, obstacles, layout.canvasHeightPct);
}

/* ---------- Component ---------- */

export function OfficePage(): JSX.Element {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<Container | null>(null);
  const sceneContainerRef = useRef<Container | null>(null);
  const nodesRef = useRef<Map<string, AgentNode>>(new Map());
  const initialSyncDoneRef = useRef(false);
  const moveSpeedRef = useRef(DEFAULT_MOVE_SPEED);
  const tbConfigRef = useRef<ThoughtBubbleConfig>({ enabled: true, max_length: 120 });
  const gridRef = useRef<Grid | null>(null);
  const layoutRef = useRef<OfficeLayout | null>(null);
  const [pixiReady, setPixiReady] = useState(false);

  const agentsMap = useAgentStore((s) => s.agents);
  const setManyAgents = useAgentStore((s) => s.setMany);
  const pushError = useErrorStore((s) => s.push);
  const settings = useAppSettingsStore((s) => s.settings);
  const [roamTick, setRoamTick] = useState(0);
  const [focusedRecentEvents, setFocusedRecentEvents] = useState<RecentEvent[]>([]);
  const [focusedEventsLoading, setFocusedEventsLoading] = useState(false);
  const focusedAgentId = searchParams.get("agent_id") ?? "";
  const selectedTerminal = searchParams.get("terminal_session_id") ?? "";

  useEffect(() => {
    moveSpeedRef.current = settings?.operations?.move_speed_px_per_sec ?? DEFAULT_MOVE_SPEED;
    tbConfigRef.current = {
      enabled: settings?.thought_bubble?.enabled ?? true,
      max_length: settings?.thought_bubble?.max_length ?? 120,
    };
  }, [settings]);

  /* Fetch snapshot */
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        const suffix = query.toString() ? `?${query.toString()}` : "";

        const snapshotJson = await apiGet<{ agents?: Array<{ agent_id: string; status: string; thinking_text?: string | null; last_event_ts: string; terminal_session_id?: string }> }>(`/api/snapshot${suffix}`);

        if (mounted && Array.isArray(snapshotJson.agents) && snapshotJson.agents.length > 0) {
          setManyAgents(snapshotJson.agents.map((a) => ({
            agent_id: a.agent_id,
            status: a.status,
            thinking: a.thinking_text ?? null,
            last_event_ts: a.last_event_ts,
            terminal_session_id: a.terminal_session_id ?? "",
          })));
        }
      } catch (e) {
        if (mounted) pushError(t("office_title"), e instanceof Error ? e.message : "failed to load office snapshot");
      }
    })();
    return () => { mounted = false; };
  }, [setManyAgents, selectedTerminal, pushError, t]);

  /* Roam tick */
  useEffect(() => {
    const id = window.setInterval(() => setRoamTick((v) => v + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  /* Focused agent recent events */
  useEffect(() => {
    if (!focusedAgentId) { setFocusedRecentEvents([]); return; }
    let mounted = true;
    setFocusedEventsLoading(true);
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        const suffix = query.toString() ? `?${query.toString()}` : "";
        const encoded = encodeURIComponent(focusedAgentId);
        const json = await apiGet<{ agent?: { recent_events?: RecentEvent[] } }>(`/api/agents/${encoded}${suffix}`);
        if (mounted) setFocusedRecentEvents((json.agent?.recent_events ?? []).slice(0, 3));
      } catch (e) {
        if (mounted) {
          pushError(t("office_focus_title"), e instanceof Error ? e.message : "failed to load agent events");
          setFocusedRecentEvents([]);
        }
      } finally {
        if (mounted) setFocusedEventsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [focusedAgentId, selectedTerminal, pushError, t]);

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);

  /* Stable terminal ordering — new terminals are appended at end, existing order preserved.
     Uses a ref to preserve insertion order across re-renders, and a string key for memo stability. */
  const terminalOrderRef = useRef<string[]>([]);
  const terminalKey = useMemo(() => {
    const currentTids = new Set(agents.map((a) => a.terminal_session_id).filter(Boolean));
    // Remove terminals that no longer have any agents
    const kept = terminalOrderRef.current.filter((tid) => currentTids.has(tid));
    // Append new terminals at end (preserving discovery order)
    const knownSet = new Set(kept);
    for (const tid of currentTids) {
      if (!knownSet.has(tid)) kept.push(tid);
    }
    terminalOrderRef.current = kept;
    return kept.join(",");
  }, [agents]);

  const activeTerminals = useMemo(() => {
    return terminalKey ? terminalKey.split(",") : [];
  }, [terminalKey]);

  const layout = useMemo(
    () => generateOfficeLayout(activeTerminals),
    [activeTerminals],
  );

  const canvasWidth = layout.canvasWidth;
  const canvasHeight = layout.canvasHeight;

  const collisionGrid = useMemo(() => buildGridForLayout(layout), [layout]);

  const targets = useMemo(
    () => computeTargets(agents, layout, roamTick),
    [agents, layout, roamTick],
  );

  const focusedAgent = useMemo(
    () => agents.find((a) => a.agent_id === focusedAgentId) ?? null,
    [agents, focusedAgentId],
  );

  // Keep refs always up-to-date (no PixiJS recreation needed)
  useEffect(() => {
    layoutRef.current = layout;
    gridRef.current = collisionGrid;
  }, [layout, collisionGrid]);

  /* Redraw static scene when layout changes (without recreating PixiJS) */
  const redrawScene = useCallback((layout: OfficeLayout) => {
    const app = appRef.current;
    if (!app) return;

    // Remove old scene container, keep agent layer
    const oldScene = sceneContainerRef.current;
    if (oldScene) {
      app.stage.removeChild(oldScene);
      oldScene.destroy({ children: true });
    }

    // Resize renderer
    app.renderer.resize(layout.canvasWidth, layout.canvasHeight);

    // New scene container drawn below agent layer
    const scene = new Container();
    sceneContainerRef.current = scene;
    app.stage.addChildAt(scene, 0);
    drawScene(scene, layout);
  }, []);

  /* Init PixiJS — only once on mount, never recreate */
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const app = new Application();
    let destroyed = false;

    const currentLayout = layoutRef.current ?? layout;

    void (async () => {
      await app.init({
        width: currentLayout.canvasWidth,
        height: currentLayout.canvasHeight,
        background: "#e8e0d8",
        antialias: true,
      });
      if (destroyed) { app.destroy(true); return; }

      el.appendChild(app.canvas);
      appRef.current = app;

      // Scene container (static objects)
      const scene = new Container();
      sceneContainerRef.current = scene;
      app.stage.addChild(scene);
      drawScene(scene, currentLayout);

      // Agent layer (above scene)
      const layer = new Container();
      layer.sortableChildren = true;
      app.stage.addChild(layer);
      layerRef.current = layer;

      // Movement ticker with A* waypoint following
      app.ticker.add((ticker) => {
        const dt = ticker.deltaMS / 1000;
        const nodes = nodesRef.current;

        for (const [id, n] of nodes) {
          let wp: Point;
          if (n.path.length > 0 && n.pathIndex < n.path.length) {
            wp = n.path[n.pathIndex]!;
          } else {
            wp = n.tgt;
          }

          const dx = wp.x - n.cur.x;
          const dy = wp.y - n.cur.y;
          const dist = Math.hypot(dx, dy);

          if (dist < 0.5) {
            n.cur.x = wp.x;
            n.cur.y = wp.y;

            if (n.path.length > 0 && n.pathIndex < n.path.length - 1) {
              n.pathIndex++;
            } else {
              n.path = [];
              n.pathIndex = 0;

              if (n.phase === "entering") {
                n.phase = "active";
              } else if (n.phase === "exiting") {
                n.root.alpha -= 0.05;
                if (n.root.alpha <= 0) {
                  layer.removeChild(n.root);
                  n.root.destroy({ children: true });
                  nodes.delete(id);
                  continue;
                }
              }
            }
          } else {
            const step = Math.min(1, (moveSpeedRef.current * dt) / dist);
            n.cur.x += dx * step;
            n.cur.y += dy * step;
          }

          // Music note sine-wave animation
          if (n.musicNote.visible) {
            n.musicTime += dt;
            n.musicNote.y = -(AGENT_R / 2) + Math.sin(n.musicTime * 3) * 5;
            n.musicNote.alpha = 0.6 + Math.sin(n.musicTime * 2) * 0.4;
          }

          n.root.x = n.cur.x;
          n.root.y = n.cur.y;
          n.root.zIndex = Math.floor(n.cur.y);
        }
      });

      setPixiReady(true);
    })();

    return () => {
      destroyed = true;
      setPixiReady(false);
      nodesRef.current.clear();
      initialSyncDoneRef.current = false;
      layerRef.current = null;
      sceneContainerRef.current = null;
      layoutRef.current = null;
      gridRef.current = null;
      if (appRef.current) { appRef.current.destroy(true); appRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — never recreate PixiJS

  /* Redraw scene when layout changes (after initial mount) */
  useEffect(() => {
    if (!pixiReady) return;
    redrawScene(layout);
  }, [pixiReady, layout, redrawScene]);

  /* Sync agents -> PixiJS sprites */
  useEffect(() => {
    if (!pixiReady || !layerRef.current) return;
    const layer = layerRef.current;
    const nodes = nodesRef.current;
    const grid = gridRef.current;
    const curLayout = layoutRef.current ?? layout;
    const cw = curLayout.canvasWidth;
    const ch = curLayout.canvasHeight;
    const alive = new Set(agents.map((a) => a.agent_id));

    const doorPos = { x: pxX(curLayout.doorPct.x, cw), y: pxY(curLayout.doorPct.y, ch) };

    // Mark departed agents as exiting
    for (const [id, n] of nodes) {
      if (!alive.has(id) && n.phase !== "exiting") {
        n.phase = "exiting";
        if (grid) {
          const curPct = { x: (n.cur.x / cw) * 100, y: (n.cur.y / ch) * 100 };
          const waypoints = findPath(grid, curPct, curLayout.doorPct);
          if (waypoints) {
            n.path = waypoints.map((p) => ({ x: pxX(p.x, cw), y: pxY(p.y, ch) }));
            n.pathIndex = 0;
          } else {
            n.path = [];
          }
        }
        n.tgt = { ...doorPos };
      }
    }

    // Upsert agents
    const tbConfig = tbConfigRef.current;
    const isInitialSync = !initialSyncDoneRef.current;
    for (const agent of agents) {
      const rawTgt = targets[agent.agent_id];
      if (!rawTgt) continue;
      const tp = { x: pxX(rawTgt.x, cw), y: pxY(rawTgt.y, ch) };

      let n = nodes.get(agent.agent_id);
      if (!n) {
        const spawnPos = isInitialSync ? tp : doorPos;
        n = createNode(agent, spawnPos, tbConfig);
        if (isInitialSync) n.phase = "active";
        layer.addChild(n.root);
        nodes.set(agent.agent_id, n);

        if (!isInitialSync && grid) {
          const waypoints = findPath(grid, curLayout.doorPct, rawTgt);
          if (waypoints) {
            n.path = waypoints.map((p) => ({ x: pxX(p.x, cw), y: pxY(p.y, ch) }));
            n.pathIndex = 0;
          }
        }
      }

      if (n.phase !== "exiting") {
        const prevTgt = n.tgt;
        const tgtDist = Math.hypot(tp.x - prevTgt.x, tp.y - prevTgt.y);
        if (tgtDist > 5 && grid) {
          const curPct = { x: (n.cur.x / cw) * 100, y: (n.cur.y / ch) * 100 };
          const waypoints = findPath(grid, curPct, rawTgt);
          if (waypoints) {
            n.path = waypoints.map((p) => ({ x: pxX(p.x, cw), y: pxY(p.y, ch) }));
            n.pathIndex = 0;
          } else {
            n.path = [];
          }
        }
        n.tgt = tp;

        if (n.status !== agent.status || n.thinking !== agent.thinking) {
          refreshNode(n, agent, tbConfig);
        }
        n.root.alpha = focusedAgentId && focusedAgentId !== agent.agent_id ? 0.4 : 1;
      }
    }
    if (isInitialSync && agents.length > 0) {
      initialSyncDoneRef.current = true;
    }
  }, [agents, targets, focusedAgentId, pixiReady, layout]);

  return (
    <section>
      <h2>{t("office_title")}</h2>
      <p>{t("office_subtitle")}</p>

      <div
        ref={wrapperRef}
        className="office-canvas"
        style={{ width: "100%", maxWidth: canvasWidth }}
      />

      {focusedAgent ? (
        <article className="panel focus-panel">
          <h3>{t("office_focus_title")}</h3>
          <p><strong>{focusedAgent.agent_id}</strong></p>
          <p>{t("office_focus_status")}: {focusedAgent.status}</p>
          {focusedAgent.thinking ? (
            <p>{t("common_thinking")}: {focusedAgent.thinking}</p>
          ) : null}
          <p>{t("office_focus_last_event")}: {focusedAgent.last_event_ts}</p>
          <h4>{t("office_focus_recent_events")}</h4>
          {focusedEventsLoading ? <p>{t("common_loading")}</p> : null}
          {!focusedEventsLoading && focusedRecentEvents.length === 0 ? <p>{t("office_focus_empty_recent")}</p> : null}
          {!focusedEventsLoading && focusedRecentEvents.length > 0 ? (
            <ul className="compact-list">
              {focusedRecentEvents.map((evt) => (
                <li key={evt.id}>{evt.ts} | {evt.type}</li>
              ))}
            </ul>
          ) : null}
          <p>
            <Link
              to={{
                pathname: "/agents",
                search: (() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("agent_id", focusedAgent.agent_id);
                  return params.toString() ? `?${params.toString()}` : "";
                })()
              }}
            >
              {t("office_focus_open_agents")}
            </Link>
          </p>
          <p>{t("office_focus_hint")}</p>
        </article>
      ) : null}
    </section>
  );
}
