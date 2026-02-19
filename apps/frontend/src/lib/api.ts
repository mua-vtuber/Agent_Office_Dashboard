import { AUTH_TOKEN, getBackendOrigin } from "./constants";

/**
 * Authenticated fetch wrapper.
 * Prepends backend origin, injects Authorization header, throws on non-ok.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (AUTH_TOKEN) headers.set("Authorization", `Bearer ${AUTH_TOKEN}`);
  const res = await fetch(`${getBackendOrigin()}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    if (text.toLowerCase().includes("<!doctype")) {
      throw new Error(
        `API returned HTML instead of JSON for ${path}. Check backend URL/proxy configuration.`
      );
    }
    throw new Error(`API returned non-JSON response for ${path} (content-type: ${contentType || "unknown"})`);
  }
  return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`API returned non-JSON response for ${path}: ${text.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(`API returned non-JSON response for ${path}: ${text.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}
