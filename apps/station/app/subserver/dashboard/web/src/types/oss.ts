/**
 * DTOs for /dashboard/api/oss/* — mirror dashboard/domain/oss.go.
 */

export interface OSSBucketSummary {
  id: string;
  name: string;
  owner_actor_id: string;
  kind: string;
  system_key?: string;
  default_visibility: string;
  quota_bytes: number;
  used_bytes: number;
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface OSSBucketListResponse {
  items: OSSBucketSummary[];
  total: number;
}

export interface OSSObjectSummary {
  id: string;
  key: string;
  name: string;
  size: number;
  mime: string;
  backend: string;
  bucket_id: string;
  owner_actor_id: string;
  visibility: string;
  chat_session_id?: string;
  created_at: string;
}

export interface OSSObjectListResponse {
  items: OSSObjectSummary[];
  total: number;
  page: number;
}

export interface OSSAuditEvent {
  id: number;
  ts: string;
  action: string;
  file_key: string;
  bucket_id: string;
  actor_id: string;
  peer_station_id?: string;
  size_bytes: number;
  outcome: string;
  reason?: string;
}

export interface OSSAuditListResponse {
  items: OSSAuditEvent[];
  total: number;
  page: number;
}

export interface OSSOwnerUsage {
  owner_actor_id: string;
  bytes: number;
  files: number;
}

export interface OSSVisibilityCount {
  visibility: string;
  files: number;
  bytes: number;
}

export interface OSSUsageSummary {
  total_bytes: number;
  total_files: number;
  bucket_count: number;
  top_owners?: OSSOwnerUsage[];
  visibility_mix?: OSSVisibilityCount[];
}

export interface OSSFederationLocalKey {
  kid: string;
  public_key_pem: string;
  generated: boolean;
}

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

export interface OSSMessageResponse {
  message: string;
}
