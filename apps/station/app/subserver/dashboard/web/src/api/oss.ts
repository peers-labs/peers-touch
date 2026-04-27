/**
 * Object storage (OSS) admin API — /dashboard/api/oss/*.
 */

import client from './client';
import type {
  OSSBucketListResponse,
  OSSBucketSummary,
  OSSFederationLocalKey,
  OSSFederationPeersResponse,
  OSSMessageResponse,
  OSSObjectListResponse,
  OSSUsageSummary,
  OSSAuditListResponse,
} from '../types/oss';

export async function listBuckets(): Promise<OSSBucketListResponse> {
  const { data } = await client.get<OSSBucketListResponse>('/oss/buckets');
  return data;
}

export async function getBucket(id: string): Promise<OSSBucketSummary> {
  const { data } = await client.get<OSSBucketSummary>(`/oss/buckets/${encodeURIComponent(id)}`);
  return data;
}

export interface ListBucketObjectsParams {
  page?: number;
  page_size?: number;
  owner_actor_id?: string;
  visibility?: string;
  mime?: string;
}

export async function listBucketObjects(
  bucketId: string,
  params?: ListBucketObjectsParams,
): Promise<OSSObjectListResponse> {
  const { data } = await client.get<OSSObjectListResponse>(
    `/oss/buckets/${encodeURIComponent(bucketId)}/objects`,
    { params },
  );
  return data;
}

export interface ListObjectsParams {
  bucket_id?: string;
  owner_actor_id?: string;
  visibility?: string;
  mime?: string;
  page?: number;
  page_size?: number;
}

export async function listObjects(params?: ListObjectsParams): Promise<OSSObjectListResponse> {
  const { data } = await client.get<OSSObjectListResponse>('/oss/objects', { params });
  return data;
}

export interface GetOSSAuditParams {
  action?: string;
  actor_id?: string;
  bucket_id?: string;
  file_key?: string;
  outcome?: string;
  since?: string;
  until?: string;
  page?: number;
  page_size?: number;
}

export async function getOSSAudit(params?: GetOSSAuditParams): Promise<OSSAuditListResponse> {
  const { data } = await client.get<OSSAuditListResponse>('/oss/audit', { params });
  return data;
}

export async function getOSSUsage(): Promise<OSSUsageSummary> {
  const { data } = await client.get<OSSUsageSummary>('/oss/usage');
  return data;
}

export async function getFederationMe(): Promise<OSSFederationLocalKey> {
  const { data } = await client.get<OSSFederationLocalKey>('/oss/federation/me');
  return data;
}

export async function getFederationPeers(): Promise<OSSFederationPeersResponse> {
  const { data } = await client.get<OSSFederationPeersResponse>('/oss/federation/peers');
  return data;
}

export async function pinFederationPeer(peerId: string): Promise<OSSMessageResponse> {
  const { data } = await client.post<OSSMessageResponse>(
    `/oss/federation/peers/${encodeURIComponent(peerId)}/pin`,
  );
  return data;
}

export async function unpinFederationPeer(peerId: string): Promise<OSSMessageResponse> {
  const { data } = await client.post<OSSMessageResponse>(
    `/oss/federation/peers/${encodeURIComponent(peerId)}/unpin`,
  );
  return data;
}
