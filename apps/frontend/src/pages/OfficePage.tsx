import { useEffect, useMemo, useRef, useState } from "react";
import { BACKEND_ORIGIN } from "../lib/constants";
import { useAgentStore, type AgentView } from "../stores/agent-store";

type Point = { x: number; y: number };
type PositionMap = Record<string, Point>;
type Bounds = { x1: number; x2: number; y1: number; y2: number };

const pantryZone: Bounds = { x1: 76, x2: 100, y1: 0, y2: 100 };
const roamZone: Bounds = { x1: 8, x2: 70, y1: 12, y2: 92 };
const seatPoints: Point[] = [
  { x: 20, y: 18 },
  { x: 14, y: 30 },
  { x: 24, y: 30 },
  { x: 14, y: 46 },
  { x: 24, y: 46 },
  { x: 14, y: 62 },
  { x: 24, y: 62 },
  { x: 46, y: 30 },
  { x: 56, y: 30 },
  { x: 46, y: 46 },
  { x: 56, y: 46 },
  { x: 46, y: 62 },
  { x: 56, y: 62 }
];
const meetingSpots: Point[] = [
  { x: 40, y: 34 },
  { x: 40, y: 50 },
  { x: 40, y: 66 }
];

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

function isManager(agentId: string): boolean {
  return agentId.endsWith("/leader");
}

function statusClass(status: string): string {
  if (status === "working") return "working";
  if (status === "failed") return "failed";
  if (status === "resting") return "resting";
  if (status === "meeting" || status === "handoff" || status === "returning") return "meeting";
  if (status === "breakroom") return "breakroom";
  if (status === "roaming") return "roaming";
  if (status === "pending_input") return "pending";
  return "idle";
}

function seatByAgent(agent: AgentView, workers: AgentView[]): Point {
  if (isManager(agent.agent_id)) return seatPoints[0] ?? { x: 20, y: 18 };
  const workerIndex = workers.findIndex((w) => w.agent_id === agent.agent_id);
  return seatPoints[(workerIndex % (seatPoints.length - 1)) + 1] ?? seatPoints[1] ?? { x: 14, y: 30 };
}

function targetByStatus(agent: AgentView, workers: AgentView[], roamTick: number): Point {
  if (agent.status === "meeting" || agent.status === "handoff" || agent.status === "returning") {
    const idx = hashSeed(agent.agent_id) % meetingSpots.length;
    return meetingSpots[idx] ?? meetingSpots[0] ?? { x: 40, y: 50 };
  }

  if (agent.status === "breakroom" || agent.status === "offline") {
    return pickInZone(pantryZone, hashSeed(`${agent.agent_id}-pantry`));
  }

  if (agent.status === "roaming" || agent.status === "completed") {
    return pickInZone(roamZone, hashSeed(`${agent.agent_id}-roam-${roamTick}`));
  }

  return seatByAgent(agent, workers);
}

export function OfficePage(): JSX.Element {
  const agentsMap = useAgentStore((s) => s.agents);
  const setManyAgents = useAgentStore((s) => s.setMany);
  const [error, setError] = useState<string>("");
  const [roamTick, setRoamTick] = useState(0);
  const [positions, setPositions] = useState<PositionMap>({});
  const lastTsRef = useRef<number>(performance.now());

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch(`${BACKEND_ORIGIN}/api/snapshot`);
        const json = (await res.json()) as { agents?: AgentView[] };
        if (mounted && Array.isArray(json.agents)) {
          setManyAgents(json.agents);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : "failed to load office snapshot");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [setManyAgents]);

  useEffect(() => {
    const timer = window.setInterval(() => setRoamTick((v) => v + 1), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const agents = useMemo(() => Object.values(agentsMap), [agentsMap]);
  const workers = useMemo(
    () => agents.filter((a) => !isManager(a.agent_id)).sort((a, b) => a.agent_id.localeCompare(b.agent_id)),
    [agents]
  );

  const targets = useMemo(() => {
    return Object.fromEntries(agents.map((agent) => [agent.agent_id, targetByStatus(agent, workers, roamTick)]));
  }, [agents, workers, roamTick]);

  useEffect(() => {
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.max(0.001, (now - lastTsRef.current) / 1000);
      lastTsRef.current = now;

      setPositions((prev) => {
        const next: PositionMap = {};
        for (const agent of agents) {
          const target = targets[agent.agent_id] ?? seatByAgent(agent, workers);
          const current = prev[agent.agent_id] ?? target;
          const speed = agent.status === "meeting" || agent.status === "handoff" ? 42 : 28;
          const dx = target.x - current.x;
          const dy = target.y - current.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 0.8) {
            next[agent.agent_id] = target;
            continue;
          }
          const maxStep = speed * dt;
          const ratio = Math.min(1, maxStep / dist);
          next[agent.agent_id] = {
            x: current.x + dx * ratio,
            y: current.y + dy * ratio
          };
        }
        return next;
      });

      frame = window.requestAnimationFrame(step);
    };

    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [agents, targets, workers]);

  return (
    <section>
      <h2>Office</h2>
      <p>좌측 T자(팀장 포함) + 중앙 블록 + 우측 탕비실(`kr_t_left_v2`) 레이아웃입니다.</p>
      {error ? <p className="error">{error}</p> : null}

      <div className="office-canvas" role="img" aria-label="agent office layout">
        <div className="zone entrance">입구</div>
        <div className="zone t-cluster">좌측 T 구역</div>
        <div className="zone center-block">중앙 팀원 구역</div>
        <div className="zone pantry">탕비실</div>
        <div className="zone pantry-lane">탕비실 문 동선</div>
        <div className="zone meeting-lane">미팅 레인</div>

        {seatPoints.map((p, idx) => (
          <div key={`seat-${idx}`} className="seat-dot" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
        ))}

        {agents.map((agent) => {
          const pos = positions[agent.agent_id] ?? targets[agent.agent_id] ?? { x: 12, y: 90 };
          const mode = statusClass(agent.status);
          const name = agent.agent_id.split("/").at(-1) ?? agent.agent_id;
          return (
            <div key={agent.agent_id} className={`office-agent ${mode}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
              <span className="agent-body" />
              {mode === "working" ? (
                <span className="paper">
                  <span />
                  <span />
                  <span />
                </span>
              ) : null}
              {mode === "failed" ? <span className="state-icon warn">!</span> : null}
              {mode === "pending" ? <span className="state-icon wait">...</span> : null}
              {mode === "resting" ? <span className="state-icon zzz">Zzz</span> : null}
              <span className="agent-name">{name}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
