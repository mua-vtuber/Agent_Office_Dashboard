import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { defaultSettings, type Settings } from "@aod/shared-schema";
import { apiGet } from "../lib/api";
import { useAgentStore, type AgentView } from "../stores/agent-store";
import { useAppSettingsStore } from "../stores/app-settings-store";
import { useErrorStore } from "../stores/error-store";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildCharacter } from "../lib/character/builder";
import { CHAR_W } from "../lib/character/types";

const AGENT_R = 10;
const DEFAULT_MOVE_SPEED = 120;

/* ---------- Types ---------- */

type Point = { x: number; y: number };
type Bounds = { x_min: number; x_max: number; y_min: number; y_max: number };
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

function pickInZone(zone: Bounds, seed: number): Point {
  const rx = ((seed % 1000) / 1000) * (zone.x_max - zone.x_min) + zone.x_min;
  const ry = (((seed >> 3) % 1000) / 1000) * (zone.y_max - zone.y_min) + zone.y_min;
  return { x: Number(rx.toFixed(2)), y: Number(ry.toFixed(2)) };
}

function isManager(id: string): boolean { return id.endsWith("/leader"); }

function seatFor(agent: AgentView, workers: AgentView[], seatPoints: Point[]): Point {
  if (isManager(agent.agent_id)) return seatPoints[0] ?? { x: 0, y: 0 };
  const idx = workers.findIndex((w) => w.agent_id === agent.agent_id);
  const workerSeats = seatPoints.length - 1;
  if (workerSeats <= 0) return seatPoints[0] ?? { x: 0, y: 0 };
  const seatIdx = (idx % workerSeats) + 1;
  const base = seatPoints[seatIdx] ?? seatPoints[1] ?? { x: 0, y: 0 };
  // When more workers than seats, offset overflow agents so they don't overlap exactly
  const overflow = Math.floor(idx / workerSeats);
  if (overflow === 0) return base;
  const seed = hashSeed(agent.agent_id);
  const angle = ((seed % 360) * Math.PI) / 180;
  const radius = 1.5 + (overflow * 1.2);
  return { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius };
}

function targetFor(
  agent: AgentView,
  workers: AgentView[],
  tick: number,
  seatPoints: Point[],
  meetingSpots: Point[],
  pantryZone: Bounds,
  roamZone: Bounds
): Point {
  const s = agent.status;
  if (s === "meeting" || s === "handoff" || s === "returning") {
    const i = hashSeed(agent.agent_id) % meetingSpots.length;
    const spot = meetingSpots[i] ?? seatFor(agent, workers, seatPoints);
    // Offset agents within the same meeting spot so they don't stack exactly
    const seed = hashSeed(agent.agent_id + "-meet");
    const angle = ((seed % 360) * Math.PI) / 180;
    const radius = 1 + (seed % 3);
    return { x: spot.x + Math.cos(angle) * radius, y: spot.y + Math.sin(angle) * radius };
  }
  if (s === "breakroom" || s === "offline")
    return pickInZone(pantryZone, hashSeed(`${agent.agent_id}-pantry`));
  if (s === "roaming" || s === "completed")
    return pickInZone(roamZone, hashSeed(`${agent.agent_id}-roam-${tick}`));
  return seatFor(agent, workers, seatPoints);
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

/* ---------- Agent PixiJS node ---------- */

type AgentNode = {
  root: Container;
  body: Container;
  ring: Graphics;
  statusOverlay: Graphics;
  nameText: Text;
  effectText: Text;
  bubble: Container;
  bubbleBg: Graphics;
  bubbleTxt: Text;
  cur: Point;
  tgt: Point;
  status: string;
  thinking: string | null;
};

function createNode(agent: AgentView, pos: Point, tbConfig: ThoughtBubbleConfig): AgentNode {
  const root = new Container();
  root.x = pos.x;
  root.y = pos.y;

  // Pulsing ring for working status
  const ring = new Graphics();
  ring.circle(0, 0, AGENT_R + 4).stroke({ color: 0x4caf50, width: 2, alpha: 0.6 });
  ring.visible = agent.status === "working";
  root.addChild(ring);

  // Fallback body circle (shown until character loads)
  const fallback = new Container();
  const fallbackGfx = new Graphics();
  fallbackGfx.circle(0, 0, AGENT_R).fill(statusColor(agent.status));
  fallback.addChild(fallbackGfx);
  root.addChild(fallback);

  // Status overlay glow (drawn on top of character)
  const statusOverlay = new Graphics();
  statusOverlay.circle(0, 0, AGENT_R + 2).stroke({ color: statusColor(agent.status), width: 2, alpha: 0.7 });
  root.addChild(statusOverlay);

  // Agent name
  const shortName = (agent.agent_id.split("/").at(-1) ?? agent.agent_id).slice(0, 10);
  const nameText = new Text({ text: shortName, style: { fontSize: 9, fill: "#333333", fontFamily: "sans-serif" } });
  nameText.anchor.set(0.5, 0);
  nameText.y = AGENT_R + 3;
  root.addChild(nameText);

  // Effect text (!, ..., Zzz)
  const effectText = new Text({
    text: effectLabel(agent.status),
    style: { fontSize: 11, fill: "#e53935", fontFamily: "sans-serif", fontWeight: "bold" },
  });
  effectText.anchor.set(0.5, 1);
  effectText.y = -(AGENT_R + 3);
  root.addChild(effectText);

  // Speech bubble container
  const bubble = new Container();
  const bubbleBg = new Graphics();
  const bubbleTxt = new Text({ text: "", style: { fontSize: 8, fill: "#333333", fontFamily: "sans-serif" } });
  bubbleTxt.anchor.set(0.5, 0.5);
  bubble.addChild(bubbleBg);
  bubble.addChild(bubbleTxt);
  root.addChild(bubble);
  applyBubble(bubble, bubbleBg, bubbleTxt, agent.thinking, agent.status, tbConfig);

  const node: AgentNode = { root, body: fallback, ring, statusOverlay, nameText, effectText, bubble, bubbleBg, bubbleTxt, cur: { ...pos }, tgt: { ...pos }, status: agent.status, thinking: agent.thinking };

  // Async: load character sprite and replace fallback
  const charScale = (AGENT_R * 2) / CHAR_W;
  buildCharacter(agent.agent_id, charScale).then((charContainer) => {
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
    // Cloud-shaped thought bubble
    bg.roundRect(-w / 2, 0, w, h, 6)
      .fill({ color: 0xf0f4ff, alpha: 0.95 })
      .stroke({ color: 0x9999cc, width: 1 });
    // Thought trail dots (small circles below bubble)
    bg.circle(-4, h + 4, 3).fill({ color: 0xf0f4ff, alpha: 0.9 }).stroke({ color: 0x9999cc, width: 0.5 });
    bg.circle(-1, h + 10, 2).fill({ color: 0xf0f4ff, alpha: 0.8 }).stroke({ color: 0x9999cc, width: 0.5 });
  } else {
    // Standard speech bubble
    bg.roundRect(-w / 2, 0, w, h, 4)
      .fill({ color: 0xffffff, alpha: 0.92 })
      .stroke({ color: 0xbbbbbb, width: 1 });
  }

  txt.x = 0;
  txt.y = h / 2;
  container.y = -(AGENT_R + 8 + h);
}

function refreshNode(node: AgentNode, agent: AgentView, tbConfig: ThoughtBubbleConfig): void {
  // Update status overlay glow (character sprite itself is immutable)
  node.statusOverlay.clear();
  node.statusOverlay.circle(0, 0, AGENT_R + 2).stroke({ color: statusColor(agent.status), width: 2, alpha: 0.7 });
  node.ring.visible = agent.status === "working";
  node.effectText.text = effectLabel(agent.status);
  applyBubble(node.bubble, node.bubbleBg, node.bubbleTxt, agent.thinking, agent.status, tbConfig);
  node.status = agent.status;
  node.thinking = agent.thinking;
}

/* ---------- Static scene ---------- */

function drawBounds(bg: Graphics, bounds: Bounds, canvasWidth: number, canvasHeight: number, fillColor: number, alpha: number): void {
  const x = pxX(bounds.x_min, canvasWidth);
  const y = pxY(bounds.y_min, canvasHeight);
  const w = pxX(bounds.x_max - bounds.x_min, canvasWidth);
  const h = pxY(bounds.y_max - bounds.y_min, canvasHeight);
  bg.rect(x, y, w, h).fill({ color: fillColor, alpha });
}

function drawScene(stage: Container, seatPoints: Point[], officeLayout: Settings["office_layout"]): void {
  const canvasWidth = officeLayout.canvas_width;
  const canvasHeight = officeLayout.canvas_height;
  const bg = new Graphics();
  // Floor
  bg.rect(0, 0, canvasWidth, canvasHeight).fill(0xe8e0d8);
  drawBounds(bg, officeLayout.zones.left_cluster, canvasWidth, canvasHeight, 0xd4c8b8, 0.5);
  drawBounds(bg, officeLayout.zones.center_block, canvasWidth, canvasHeight, 0xc8bca8, 0.5);
  drawBounds(bg, officeLayout.zones.pantry_zone, canvasWidth, canvasHeight, 0xb8d8c8, 0.5);
  drawBounds(bg, officeLayout.zones.meeting_lane, canvasWidth, canvasHeight, 0xa8c8e8, 0.4);
  stage.addChild(bg);

  // Seats
  const seats = new Graphics();
  for (const p of seatPoints) {
    seats.circle(pxX(p.x, canvasWidth), pxY(p.y, canvasHeight), 4).fill({ color: 0x999999, alpha: 0.3 });
  }
  stage.addChild(seats);

  // Zone labels
  const ls = { fontSize: 10, fill: "#888888", fontFamily: "sans-serif" };
  const labels: Array<[string, number, number]> = [
    ["T Cluster", officeLayout.zones.left_cluster.x_min + 1, officeLayout.zones.left_cluster.y_min - 5],
    ["Center", officeLayout.zones.center_block.x_min + 1, officeLayout.zones.center_block.y_min - 5],
    ["Pantry", officeLayout.zones.pantry_zone.x_min + 1, officeLayout.zones.pantry_zone.y_min + 5],
    ["Meeting", officeLayout.zones.meeting_lane.x_min + 1, officeLayout.zones.meeting_lane.y_min - 4],
  ];
  for (const [text, x, y] of labels) {
    const t = new Text({ text, style: ls });
    t.x = pxX(Math.max(0, x), canvasWidth);
    t.y = pxY(Math.max(0, y), canvasHeight);
    t.alpha = 0.6;
    stage.addChild(t);
  }
}

/* ---------- Component ---------- */

export function OfficePage(): JSX.Element {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layerRef = useRef<Container | null>(null);
  const nodesRef = useRef<Map<string, AgentNode>>(new Map());
  const moveSpeedRef = useRef(DEFAULT_MOVE_SPEED);
  const tbConfigRef = useRef<ThoughtBubbleConfig>({ enabled: true, max_length: 120 });
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
  const officeLayout = settings?.office_layout ?? defaultSettings.office_layout;
  const canvasWidth = officeLayout.canvas_width;
  const canvasHeight = officeLayout.canvas_height;

  const seatPoints = useMemo((): Point[] => {
    return Object.entries(officeLayout.seat_positions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, point]) => point);
  }, [officeLayout]);

  const meetingSpots = useMemo((): Point[] => {
    return Object.entries(officeLayout.meeting_spots)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, point]) => point);
  }, [officeLayout]);

  useEffect(() => {
    moveSpeedRef.current = settings?.operations?.move_speed_px_per_sec ?? DEFAULT_MOVE_SPEED;
    tbConfigRef.current = {
      enabled: settings?.thought_bubble?.enabled ?? true,
      max_length: settings?.thought_bubble?.max_length ?? 120,
    };
  }, [settings]);

  /* Fetch snapshot + settings */
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        const suffix = query.toString() ? `?${query.toString()}` : "";

        const snapshotJson = await apiGet<{ agents?: Array<{ agent_id: string; status: string; thinking_text?: string | null; last_event_ts: string }> }>(`/api/snapshot${suffix}`);

        if (mounted && Array.isArray(snapshotJson.agents)) {
          setManyAgents(snapshotJson.agents.map((a) => ({
            agent_id: a.agent_id,
            status: a.status,
            thinking: a.thinking_text ?? null,
            last_event_ts: a.last_event_ts,
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
  const workers = useMemo(
    () => agents.filter((a) => !isManager(a.agent_id)).sort((a, b) => a.agent_id.localeCompare(b.agent_id)),
    [agents],
  );
  const pantryZone = officeLayout.zones.pantry_zone;
  const roamZone = officeLayout.zones.roam_zone;
  const targets = useMemo(
    () =>
      Object.fromEntries(
        agents.map((a) => [
          a.agent_id,
          targetFor(a, workers, roamTick, seatPoints, meetingSpots, pantryZone, roamZone),
        ])
      ),
    [agents, workers, roamTick, seatPoints, meetingSpots, pantryZone, roamZone],
  );
  const focusedAgent = useMemo(
    () => agents.find((a) => a.agent_id === focusedAgentId) ?? null,
    [agents, focusedAgentId],
  );

  /* Init PixiJS */
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const app = new Application();
    let destroyed = false;

    void (async () => {
      await app.init({ width: canvasWidth, height: canvasHeight, background: "#e8e0d8", antialias: true });
      if (destroyed) { app.destroy(true); return; }

      el.appendChild(app.canvas);
      appRef.current = app;

      drawScene(app.stage, seatPoints, officeLayout);
      const layer = new Container();
      layer.sortableChildren = true;
      app.stage.addChild(layer);
      layerRef.current = layer;

      // Movement + ring pulse ticker
      let elapsed = 0;
      app.ticker.add((ticker) => {
        const dt = ticker.deltaMS / 1000;
        elapsed += dt;
        const ringAlpha = 0.3 + 0.3 * Math.sin(elapsed * 4);

        for (const [, n] of nodesRef.current) {
          // Smooth movement
          const dx = n.tgt.x - n.cur.x;
          const dy = n.tgt.y - n.cur.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 0.5) {
            n.cur.x = n.tgt.x;
            n.cur.y = n.tgt.y;
          } else {
            const step = Math.min(1, (moveSpeedRef.current * dt) / dist);
            n.cur.x += dx * step;
            n.cur.y += dy * step;
          }
          n.root.x = n.cur.x;
          n.root.y = n.cur.y;
          n.root.zIndex = Math.floor(n.cur.y);

          // Pulse ring for working agents
          if (n.ring.visible) n.ring.alpha = ringAlpha;
        }
      });

      setPixiReady(true);
    })();

    return () => {
      destroyed = true;
      setPixiReady(false);
      nodesRef.current.clear();
      layerRef.current = null;
      if (appRef.current) { appRef.current.destroy(true); appRef.current = null; }
    };
  }, [seatPoints, officeLayout, canvasWidth, canvasHeight]);

  /* Sync agents -> PixiJS sprites */
  useEffect(() => {
    if (!pixiReady || !layerRef.current) return;
    const layer = layerRef.current;
    const nodes = nodesRef.current;
    const alive = new Set(agents.map((a) => a.agent_id));

    // Remove departed agents
    for (const [id, n] of nodes) {
      if (!alive.has(id)) {
        layer.removeChild(n.root);
        n.root.destroy({ children: true });
        nodes.delete(id);
      }
    }

    // Upsert agents
    const tbConfig = tbConfigRef.current;
    for (const agent of agents) {
      const rawTgt = targets[agent.agent_id] ?? seatFor(agent, workers, seatPoints);
      const tp = { x: pxX(rawTgt.x, canvasWidth), y: pxY(rawTgt.y, canvasHeight) };

      let n = nodes.get(agent.agent_id);
      if (!n) {
        n = createNode(agent, tp, tbConfig);
        layer.addChild(n.root);
        nodes.set(agent.agent_id, n);
      }

      n.tgt = tp;
      if (n.status !== agent.status || n.thinking !== agent.thinking) {
        refreshNode(n, agent, tbConfig);
      }
      n.root.alpha = focusedAgentId && focusedAgentId !== agent.agent_id ? 0.4 : 1;
    }
  }, [agents, targets, workers, focusedAgentId, pixiReady, seatPoints, canvasWidth, canvasHeight]);

  return (
    <section>
      <h2>{t("office_title")}</h2>
      <p>{t("office_subtitle")}</p>

      <div ref={wrapperRef} className="office-canvas" style={{ width: canvasWidth, maxWidth: "100%" }} />

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
