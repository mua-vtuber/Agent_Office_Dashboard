export async function fetchSnapshot(): Promise<unknown> {
  const res = await fetch("http://localhost:4800/api/snapshot");
  if (!res.ok) throw new Error("failed to fetch snapshot");
  return res.json();
}

export async function fetchAgents(): Promise<unknown> {
  const res = await fetch("http://localhost:4800/api/agents");
  if (!res.ok) throw new Error("failed to fetch agents");
  return res.json();
}
