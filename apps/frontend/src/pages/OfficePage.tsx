import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import { getBackendOrigin } from "../lib/constants";
import { useAgentStore, type AgentView } from "../stores/agent-store";
import { useAppSettingsStore } from "../stores/app-settings-store";
import { useErrorStore } from "../stores/error-store";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildCharacter } from "../lib/character/builder";
import { CHAR_W } from "../lib/character/types";

/* ---------- Canvas constants ---------- */

const CW = 800;
const CH = 560;
const AGENT_R = 10;
const DEFAULT_MOVE_SPEED = 120;

/* ---------- Types ---------- */

type Point = { x: number; y: number };
type Bounds = { x1: number; x2: number; y1: number; y2: number };
type RecentEvent = { id: string; ts: string; type: string; agent_id: string };

/* ---------- Layout constants ---------- */

const DEFAULT_SEAT_POINTS: Point[] = [
  { x: 20, y: 18 },
  { x: 14, y: 30 }, { x: 24, y: 30 },
  { x: 14, y: 46 }, { x: 24, y: 46 },
  { x: 14, y: 62 }, { x: 24, y: 62 },
  { x: 46, y: 30 }, { x: 56, y: 30 },
  { x: 46, y: 46 }, { x: 56, y: 46 },
  { x: 46, y: 62 }, { x: 56, y: 62 },
];
const DEFAULT_MEETING_SPOTS: Point[] = [
  { x: 40, y: 34 },
  { x: 40, y: 50 },
  { x: 40, y: 66 }
];

const pantryZone: Bounds = { x1: 76, x2: 100, y1: 0, y2: 100 };
const roamZone: Bounds = { x1: 8, x2: 70, y1: 12, y2: 92 };

/* ---------- Helpers ---------- */

function pxX(pct: number): number { return (pct / 100) * CW; }
function pxY(pct: number): number { return (pct / 100) * CH; }

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pickInZone(zone: Bounds, seed: number): Point {
  const rx = ((seed % 1000) / 1000) * (zone.x2 - zone.x1) + zone.x1;
  const ry = (((seed >> 3) % 1000) / 1000) * (zone.y2 - zone.y1) + zone.y1;
  return { x: Number(rx.toFixed(2)), y: Number(ry.toFixed(2)) };
}

function isManager(id: string): boolean { return id.endsWith("/leader"); }

function seatFor(agent: AgentView, workers: AgentView[], seatPoints: Point[]): Point {
  if (isManager(agent.agent_id)) return seatPoints[0] ?? { x: 20, y: 18 };
  const idx = workers.findIndex((w) => w.agent_id === agent.agent_id);
  return seatPoints[(idx % (seatPoints.length - 1)) + 1] ?? seatPoints[1] ?? { x: 14, y: 30 };
}

function targetFor(agent: AgentView, workers: AgentView[], tick: number, seatPoints: Point[], meetingSpots: Point[]): Point {
  const s = agent.status;
  if (s === "meeting" || s === "handoff" || s === "returning") {
    const i = hashSeed(agent.agent_id) % meetingSpots.length;
    return meetingSpots[i] ?? { x: 40, y: 50 };
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

function drawScene(stage: Container, seatPoints: Point[]): void {
  const bg = new Graphics();
  // Floor
  bg.rect(0, 0, CW, CH).fill(0xe8e0d8);
  // T cluster (left)
  bg.rect(pxX(4), pxY(10), pxX(30), pxY(80)).fill({ color: 0xd4c8b8, alpha: 0.5 });
  // Center block
  bg.rect(pxX(36), pxY(10), pxX(30), pxY(80)).fill({ color: 0xc8bca8, alpha: 0.5 });
  // Pantry (right)
  bg.rect(pxX(76), pxY(0), pxX(24), pxY(100)).fill({ color: 0xb8d8c8, alpha: 0.5 });
  // Meeting lane
  bg.rect(pxX(36), pxY(25), pxX(8), pxY(55)).fill({ color: 0xa8c8e8, alpha: 0.4 });
  stage.addChild(bg);

  // Seats
  const seats = new Graphics();
  for (const p of seatPoints) {
    seats.circle(pxX(p.x), pxY(p.y), 4).fill({ color: 0x999999, alpha: 0.3 });
  }
  stage.addChild(seats);

  // Zone labels
  const ls = { fontSize: 10, fill: "#888888", fontFamily: "sans-serif" };
  const labels: Array<[string, number, number]> = [
    ["T Cluster", 10, 5], ["Center", 46, 5], ["Pantry", 82, 5], ["Meeting", 37, 21],
  ];
  for (const [text, x, y] of labels) {
    const t = new Text({ text, style: ls });
    t.x = pxX(x);
    t.y = pxY(y);
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

  const seatPoints = useMemo((): Point[] => {
    const sp = settings?.office_layout?.seat_positions;
    if (sp && Object.keys(sp).length > 0) return Object.values(sp) as Point[];
    return DEFAULT_SEAT_POINTS;
  }, [settings]);

  const meetingSpots = useMemo((): Point[] => {
    const ms = settings?.office_layout?.meeting_spots;
    if (ms && Object.keys(ms).length > 0) return Object.values(ms) as Point[];
    return DEFAULT_MEETING_SPOTS;
  }, [settings]);

  /* Fetch snapshot + settings */
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const origin = getBackendOrigin();
        const query = new URLSearchParams();
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        const suffix = query.toString() ? `?${query.toString()}` : "";

        const [snapshotRes, settingsRes] = await Promise.all([
          fetch(`${origin}/api/snapshot${suffix}`),
          fetch(`${origin}/api/settings/app`),
        ]);

        const json = (await snapshotRes.json()) as { agents?: Array<{ agent_id: string; status: string; thinking_text?: string | null; last_event_ts: string }> };
        if (mounted && Array.isArray(json.agents)) {
          setManyAgents(json.agents.map((a) => ({
            agent_id: a.agent_id,
            status: a.status,
            thinking: a.thinking_text ?? null,
            last_event_ts: a.last_event_ts,
          })));
        }

        if (settingsRes.ok) {
          const sJson = (await settingsRes.json()) as {
            value?: {
              operations?: { move_speed_px_per_sec?: number };
              thought_bubble?: { enabled?: boolean; max_length?: number };
            };
          };
          const speed = sJson.value?.operations?.move_speed_px_per_sec;
          if (typeof speed === "number" && speed >= 30) moveSpeedRef.current = speed;
          const tb = sJson.value?.thought_bubble;
          if (tb) {
            tbConfigRef.current = {
              enabled: tb.enabled ?? true,
              max_length: tb.max_length ?? 120,
            };
          }
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
        const origin = getBackendOrigin();
        const query = new URLSearchParams();
        if (selectedTerminal) query.set("terminal_session_id", selectedTerminal);
        const suffix = query.toString() ? `?${query.toString()}` : "";
        const encoded = encodeURIComponent(focusedAgentId);
        const res = await fetch(`${origin}/api/agents/${encoded}${suffix}`);
        const json = (await res.json()) as { agent?: { recent_events?: RecentEvent[] } };
        if (mounted) setFocusedRecentEvents((json.agent?.recent_events ?? []).slice(0, 3));
      } catch {
        if (mounted) setFocusedRecentEvents([]);
      } finally {
        if (mounted) setFocusedEventsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [focusedAgentId, selectedTerminal]);

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const workers = useMemo(
    () => agents.filter((a) => !isManager(a.agent_id)).sort((a, b) => a.agent_id.localeCompare(b.agent_id)),
    [agents],
  );
  const targets = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.agent_id, targetFor(a, workers, roamTick, seatPoints, meetingSpots)])),
    [agents, workers, roamTick, seatPoints, meetingSpots],
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
      await app.init({ width: CW, height: CH, background: "#e8e0d8", antialias: true });
      if (destroyed) { app.destroy(true); return; }

      el.appendChild(app.canvas);
      appRef.current = app;

      drawScene(app.stage, seatPoints);
      const layer = new Container();
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
  }, [seatPoints]);

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
      const tp = { x: pxX(rawTgt.x), y: pxY(rawTgt.y) };

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
  }, [agents, targets, workers, focusedAgentId, pixiReady, seatPoints]);

  return (
    <section>
      <h2>{t("office_title")}</h2>
      <p>{t("office_subtitle")}</p>

      <div ref={wrapperRef} className="office-canvas" style={{ width: CW, maxWidth: "100%" }} />

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
