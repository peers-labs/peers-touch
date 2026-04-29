/**
 * OSS API — every `/dashboard/api/oss/*` endpoint exposed by the
 * station, grouped by surface (federation, workers, buckets,
 * objects, audit, usage).
 *
 * The corresponding station handlers live in
 * `apps/station/app/subserver/dashboard/handler.go`. Field shapes
 * mirror the Go-side `domain.OSS*` DTOs verbatim — when the server
 * changes a name or a type, this file is the explicit boundary
 * that needs to update too.
 */

import client from './client';

// ---------------------------------------------------------------------------
// Federation
// ---------------------------------------------------------------------------

/**
 * The local station's federation identity. PublicKeyPEM is safe
 * to render verbatim; the private key is NEVER returned by the
 * station — the dashboard cannot exfiltrate it even by accident.
 *
 * `generated` is true when the station had to lazily mint the
 * keypair on this read. The dashboard surfaces it so a freshly
 * provisioned station shows a clear "your federation identity was
 * just created" badge instead of "you've had this key for a while".
 */
export interface OSSFederationLocalKey {
  kid: string;
  public_key_pem: string;
  generated: boolean;
}

/**
 * One known remote station. `pinned = true` means the operator
 * has frozen the kid: a future silent rotation by the peer will
 * be rejected at verify time. `pinned = false` falls back to TOFU
 * (in v3, still rejects mismatch — re-TOFU requires forget).
 */
export interface OSSFederationPeer {
  peer_station_id: string;
  kid: string;
  public_key_pem: string;
  first_seen_at: string;
  last_seen_at: string;
  pinned: boolean;
}

export interface OSSFederationPeersResponse {
  items: OSSFederationPeer[];
}

/**
 * Body of `POST /federation/rotate-local-key`. The `_prev` kid is
 * preserved on the station for the dual-sign grace window
 * (default 24h) so peers that cached the old key can still verify
 * tokens minted just before the rotation.
 */
export interface OSSFederationRotateResponse {
  new_kid: string;
  previous_kid?: string;
  rotated_at: string;
  capability_version?: string;
}

export async function getFederationLocalKey(): Promise<OSSFederationLocalKey> {
  const { data } = await client.get<OSSFederationLocalKey>(
    '/oss/federation/me',
  );
  return data;
}

export async function listFederationPeers(): Promise<OSSFederationPeersResponse> {
  const { data } = await client.get<OSSFederationPeersResponse>(
    '/oss/federation/peers',
  );
  return data;
}

export async function pinPeer(peerStationID: string): Promise<void> {
  await client.post(
    `/oss/federation/peers/${encodeURIComponent(peerStationID)}/pin`,
  );
}

export async function unpinPeer(peerStationID: string): Promise<void> {
  await client.post(
    `/oss/federation/peers/${encodeURIComponent(peerStationID)}/unpin`,
  );
}

/**
 * Hard-removes the peer's TOFU row. The next inbound request from
 * the peer re-pairs from scratch. Distinct from {@link unpinPeer},
 * which only flips the `pinned` flag (the kid is preserved and a
 * future silent rotation would still be silently accepted under
 * unpinned-TOFU semantics).
 */
export async function forgetPeer(peerStationID: string): Promise<void> {
  await client.delete(
    `/oss/federation/peers/${encodeURIComponent(peerStationID)}`,
  );
}

/**
 * Generate a fresh Ed25519 keypair for federation. The previous
 * keypair is moved to the `*_prev` slot for a 24h dual-sign
 * window; after that the `KeyRotationFinalizer` worker clears
 * `_prev`.
 *
 * Pinned remote peers will see `peer_pinned_mismatch` once they
 * pull a token signed with the new key. Operators must re-pin on
 * the remote side. This is the trade-off of true pinning —
 * surfaced in the rotate confirmation modal.
 */
export async function rotateFederationLocalKey(): Promise<OSSFederationRotateResponse> {
  const { data } = await client.post<OSSFederationRotateResponse>(
    '/oss/federation/rotate-local-key',
  );
  return data;
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

/**
 * One background worker's projected health state, derived from
 * `oss_audit` action=`worker_run` rows over the lookback window.
 *
 * `last_run_at` is the zero time (`"0001-01-01T00:00:00Z"`) when
 * the worker has not emitted any heartbeat in the window — render
 * such rows as "never" rather than as a dystopian 1-AD timestamp.
 *
 * `last_error` is non-empty only when `last_outcome === "error"`.
 */
export interface OSSWorkerHeartbeat {
  name: string;
  last_run_at: string;
  last_outcome: 'ok' | 'error' | string;
  last_error?: string;
  run_count: number;
  error_count: number;
}

export interface OSSWorkersSummary {
  items: OSSWorkerHeartbeat[];
  lookback_hours: number;
}

/**
 * @param hours optional lookback window. Server defaults to 24h
 *              when omitted, capped at 30 days.
 */
export async function listWorkers(hours?: number): Promise<OSSWorkersSummary> {
  const params: Record<string, string> = {};
  if (hours !== undefined && hours > 0) {
    params.hours = String(hours);
  }
  const { data } = await client.get<OSSWorkersSummary>('/oss/workers', { params });
  return data;
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/**
 * One bucket row. Mirrors `domain.OSSBucketSummary` on the station.
 * `system_key` is non-empty only for canonical buckets the station
 * provisions itself (e.g. `chat`, `attachments`); the dashboard
 * uses it to gate destructive actions.
 */
export interface OSSBucketSummary {
  id: string;
  name: string;
  owner_actor_id: string;
  kind: 'user' | 'system' | string;
  system_key?: string;
  default_visibility: 'public' | 'chat' | 'private' | string;
  quota_bytes: number;
  used_bytes: number;
  file_count: number;
  ttl_days: number;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface OSSBucketListResponse {
  items: OSSBucketSummary[];
  total: number;
}

/**
 * Body of `POST /oss/buckets`. The station always stamps `kind = user`
 * — there is no operator override for that on purpose. All numeric
 * fields default to zero (`quota_bytes = 0` ⇒ unlimited;
 * `ttl_days = 0` ⇒ no auto-TTL).
 */
export interface OSSBucketCreateRequest {
  owner_actor_id: string;
  name: string;
  default_visibility: 'public' | 'chat' | 'private';
  quota_bytes: number;
  ttl_days: number;
  description?: string;
}

/**
 * Body of `PATCH /oss/buckets/:id`. Each field is optional; an
 * omitted field means "leave unchanged". An empty `description`
 * string explicitly *clears* the description (the station treats
 * `*string` nil-vs-set differently). Name and owner_actor_id are
 * intentionally not patchable — recreate the bucket instead.
 */
export interface OSSBucketUpdateRequest {
  default_visibility?: 'public' | 'chat' | 'private';
  quota_bytes?: number;
  ttl_days?: number;
  description?: string;
}

export async function listBuckets(): Promise<OSSBucketListResponse> {
  const { data } = await client.get<OSSBucketListResponse>('/oss/buckets');
  return data;
}

export async function getBucket(id: string): Promise<OSSBucketSummary> {
  const { data } = await client.get<OSSBucketSummary>(
    `/oss/buckets/${encodeURIComponent(id)}`,
  );
  return data;
}

export async function createBucket(
  req: OSSBucketCreateRequest,
): Promise<OSSBucketSummary> {
  const { data } = await client.post<OSSBucketSummary>('/oss/buckets', req);
  return data;
}

export async function updateBucket(
  id: string,
  req: OSSBucketUpdateRequest,
): Promise<OSSBucketSummary> {
  const { data } = await client.patch<OSSBucketSummary>(
    `/oss/buckets/${encodeURIComponent(id)}`,
    req,
  );
  return data;
}

/**
 * Soft-delete via `gorm.DeletedAt`. Pass `force: true` to skip the
 * "non-empty bucket" guard. The station NEVER allows deleting a
 * `system`-kind bucket regardless of `force`.
 */
export async function deleteBucket(id: string, force = false): Promise<void> {
  const url = `/oss/buckets/${encodeURIComponent(id)}` + (force ? '?force=true' : '');
  await client.delete(url);
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

/** One row in the object list view. */
export interface OSSObjectSummary {
  id: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  backend: string;
  bucket_id: string;
  owner_actor_id: string;
  visibility: 'public' | 'chat' | 'private' | string;
  chat_session_id?: string;
  created_at: string;
}

export interface OSSObjectListResponse {
  items: OSSObjectSummary[];
  total: number;
  page: number;
}

/**
 * Full admin detail for one object. `expires_at` / `deleted_at` are
 * present here (omitted from the list view) so an operator who is
 * about to act on a single row sees the lifecycle state.
 */
export interface OSSObjectAdminDetail extends OSSObjectSummary {
  sha256?: string;
  expires_at?: string | null;
  deleted_at?: string | null;
  updated_at: string;
}

export interface OSSObjectListQuery {
  bucket_id?: string;
  owner_actor_id?: string;
  visibility?: string;
  mime?: string;
  page?: number;
  page_size?: number;
}

/**
 * Admin PATCH body. The station distinguishes:
 *
 *   - `visibility = undefined` ⇒ leave alone
 *   - `chat_session_id = ""`   ⇒ clear (chat session ids cannot be empty
 *                                 legitimately, so empty string is
 *                                 unambiguous)
 *   - `expires_at = undefined` AND `clear_expires_at = false` ⇒ leave
 *   - `clear_expires_at = true`                             ⇒ NULL out
 *   - `expires_at = <iso>`                                  ⇒ set
 *
 * Bucket move is not supported via admin — quota transfer is
 * owner-scoped by design.
 */
export interface OSSObjectAdminPatchRequest {
  visibility?: 'public' | 'chat' | 'private';
  chat_session_id?: string;
  expires_at?: string;
  clear_expires_at?: boolean;
}

export async function listObjects(
  q: OSSObjectListQuery,
): Promise<OSSObjectListResponse> {
  const params: Record<string, string | number> = {};
  if (q.bucket_id) params.bucket_id = q.bucket_id;
  if (q.owner_actor_id) params.owner_actor_id = q.owner_actor_id;
  if (q.visibility) params.visibility = q.visibility;
  if (q.mime) params.mime = q.mime;
  if (q.page && q.page > 0) params.page = q.page;
  if (q.page_size && q.page_size > 0) params.page_size = q.page_size;
  const { data } = await client.get<OSSObjectListResponse>('/oss/objects', { params });
  return data;
}

export async function getObject(id: string): Promise<OSSObjectAdminDetail> {
  const { data } = await client.get<OSSObjectAdminDetail>(
    `/oss/objects/${encodeURIComponent(id)}`,
  );
  return data;
}

export async function adminPatchObject(
  id: string,
  req: OSSObjectAdminPatchRequest,
): Promise<OSSObjectAdminDetail> {
  const { data } = await client.patch<OSSObjectAdminDetail>(
    `/oss/objects/${encodeURIComponent(id)}`,
    req,
  );
  return data;
}

export async function adminDeleteObject(id: string): Promise<OSSObjectAdminDetail> {
  const { data } = await client.delete<OSSObjectAdminDetail>(
    `/oss/objects/${encodeURIComponent(id)}`,
  );
  return data;
}

/**
 * Optional knobs for {@link adminUploadObject}. Each is forwarded as
 * a multipart form field; the station's `AdminUploadObject` service
 * applies the same fall-backs the user-side `/sub-oss/upload`
 * endpoint does (visibility defaults to the bucket's
 * `default_visibility`; the chat session id is required iff the
 * resolved visibility is `chat`; the filename override is purely
 * cosmetic — the storage key is still derived by CAS).
 */
export interface OSSAdminUploadOptions {
  visibility?: 'public' | 'chat' | 'private';
  chat_session_id?: string;
  filename?: string;
  /** Optional progress callback wired into axios `onUploadProgress`. */
  onProgress?: (loaded: number, total: number | undefined) => void;
}

/**
 * Operator-driven upload to a specific bucket. The bucket's
 * `owner_actor_id` is what the station stamps on the resulting
 * `oss_files` row — the operator acts on behalf of the owner.
 *
 * The handler is multipart/form-data; we let axios infer the
 * boundary and disable the per-request timeout because file
 * uploads can legitimately run minutes on slow links.
 */
export async function adminUploadObject(
  bucketID: string,
  file: File,
  opts: OSSAdminUploadOptions = {},
): Promise<OSSObjectAdminDetail> {
  const form = new FormData();
  form.append('file', file);
  if (opts.visibility) form.append('visibility', opts.visibility);
  if (opts.chat_session_id) form.append('chat_session_id', opts.chat_session_id);
  if (opts.filename) form.append('filename', opts.filename);

  const { data } = await client.post<OSSObjectAdminDetail>(
    `/oss/buckets/${encodeURIComponent(bucketID)}/upload`,
    form,
    {
      // Let axios + the browser set `Content-Type: multipart/form-data;
      // boundary=…` — manually setting it would clobber the boundary.
      headers: { 'Content-Type': undefined as unknown as string },
      timeout: 0,
      onUploadProgress: opts.onProgress
        ? (e) => opts.onProgress?.(e.loaded, e.total ?? undefined)
        : undefined,
    },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * One `oss_audit` row. `peer_station_id` is non-empty only for
 * federation events (peer GET, peer key cache mutations…).
 * `reason` carries a stable code for denials so operators can
 * group / chart them.
 */
export interface OSSAuditEvent {
  id: number;
  ts: string;
  action: string;
  file_key: string;
  bucket_id: string;
  actor_id: string;
  peer_station_id?: string;
  size_bytes: number;
  outcome: 'ok' | 'denied' | 'error' | string;
  reason?: string;
}

export interface OSSAuditListResponse {
  items: OSSAuditEvent[];
  total: number;
  page: number;
}

export interface OSSAuditListQuery {
  action?: string;
  actor_id?: string;
  bucket_id?: string;
  file_key?: string;
  outcome?: string;
  /** RFC3339 timestamp; ignored if unparseable on the server. */
  since?: string;
  /** RFC3339 timestamp; ignored if unparseable on the server. */
  until?: string;
  page?: number;
  page_size?: number;
}

export async function listAudit(
  q: OSSAuditListQuery,
): Promise<OSSAuditListResponse> {
  const params: Record<string, string | number> = {};
  if (q.action) params.action = q.action;
  if (q.actor_id) params.actor_id = q.actor_id;
  if (q.bucket_id) params.bucket_id = q.bucket_id;
  if (q.file_key) params.file_key = q.file_key;
  if (q.outcome) params.outcome = q.outcome;
  if (q.since) params.since = q.since;
  if (q.until) params.until = q.until;
  if (q.page && q.page > 0) params.page = q.page;
  if (q.page_size && q.page_size > 0) params.page_size = q.page_size;
  const { data } = await client.get<OSSAuditListResponse>('/oss/audit', { params });
  return data;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface OSSOwnerUsage {
  owner_actor_id: string;
  bytes: number;
  files: number;
}

export interface OSSVisibilityCount {
  visibility: 'public' | 'chat' | 'private' | string;
  files: number;
  bytes: number;
}

/**
 * Headline-level OSS counters for the overview surface.
 * `top_owners` and `visibility_mix` may be empty on a fresh
 * station — the usage tab handles the empty case explicitly so it
 * does not flicker into a "broken" state.
 */
export interface OSSUsageSummary {
  total_bytes: number;
  total_files: number;
  bucket_count: number;
  top_owners?: OSSOwnerUsage[];
  visibility_mix?: OSSVisibilityCount[];
}

export async function getUsage(): Promise<OSSUsageSummary> {
  const { data } = await client.get<OSSUsageSummary>('/oss/usage');
  return data;
}
