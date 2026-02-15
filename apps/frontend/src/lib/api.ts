import { BACKEND_ORIGIN } from "./constants";

export async function fetchSnapshot(): Promise<unknown> {
  const res = await fetch(`${BACKEND_ORIGIN}/api/snapshot`);
  if (!res.ok) throw new Error("failed to fetch snapshot");
  return res.json();
}

export async function fetchAgents(): Promise<unknown> {
  const res = await fetch(`${BACKEND_ORIGIN}/api/agents`);
  if (!res.ok) throw new Error("failed to fetch agents");
  return res.json();
}
