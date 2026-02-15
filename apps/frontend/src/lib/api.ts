import { AUTH_TOKEN, BACKEND_ORIGIN } from "./constants";

export function authHeaders(): Record<string, string> {
  if (!AUTH_TOKEN) return {};
  return { Authorization: `Bearer ${AUTH_TOKEN}` };
}

export function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (AUTH_TOKEN) headers.set("Authorization", `Bearer ${AUTH_TOKEN}`);
  return fetch(input, { ...init, headers });
}

export async function fetchSnapshot(): Promise<unknown> {
  const res = await authFetch(`${BACKEND_ORIGIN}/api/snapshot`);
  if (!res.ok) throw new Error("failed to fetch snapshot");
  return res.json();
}

export async function fetchAgents(): Promise<unknown> {
  const res = await authFetch(`${BACKEND_ORIGIN}/api/agents`);
  if (!res.ok) throw new Error("failed to fetch agents");
  return res.json();
}
