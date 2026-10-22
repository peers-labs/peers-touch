import type {
  Catalog,
  Draft,
  Publication,
  Session,
  Validation,
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(isMutation(init.method) ? { "X-CSRF-Token": csrfToken() } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let code = `http_${response.status}`;
    try {
      code = (await response.json() as { error?: string }).error ?? code;
    } catch {
      // Error bodies are optional; status remains authoritative.
    }
    throw new ApiError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  session: () => request<Session>("/api/admin/auth/session"),
  logout: () => request<void>("/api/admin/auth/logout", { method: "POST" }),
  loadDraft: (channel: string) =>
    request<Draft>(`/api/admin/catalog?channel=${encodeURIComponent(channel)}`),
  validate: (catalog: Catalog) =>
    request<Validation>("/api/admin/catalog/validate", {
      method: "POST",
      body: JSON.stringify(catalog),
    }),
  saveDraft: (baseRevision: string, catalog: Catalog) =>
    request<Draft>("/api/admin/catalog", {
      method: "PUT",
      body: JSON.stringify({ base_revision: baseRevision, catalog }),
    }),
  publish: (
    channel: string,
    baseRevision: string,
    acknowledgedDigest: string,
  ) =>
    request<Publication>("/api/admin/publications", {
      method: "POST",
      body: JSON.stringify({
        channel,
        base_revision: baseRevision,
        acknowledged_digest: acknowledgedDigest,
      }),
    }),
  publications: (channel: string) =>
    request<{ publications: Publication[] }>(
      `/api/admin/publications?channel=${encodeURIComponent(channel)}&limit=50`,
    ),
  restore: (
    channel: string,
    historicalRevision: string,
    currentRevision: string,
  ) =>
    request<Draft>("/api/admin/catalog/restore", {
      method: "POST",
      body: JSON.stringify({
        channel,
        historical_revision: historicalRevision,
        current_revision: currentRevision,
      }),
    }),
};

function csrfToken(): string {
  const prefix = "peers_xcfg_csrf=";
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

function isMutation(method?: string): boolean {
  return !!method && !["GET", "HEAD"].includes(method.toUpperCase());
}
