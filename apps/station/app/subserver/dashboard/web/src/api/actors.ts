/**
 * Actors management API — CRUD operations for user actors.
 */

import client from './client';

export interface ActorDetail {
  ptid: string;
  preferred_username: string;
  name: string;
  email: string;
  summary: string;
  avatar_url: string;
  status: string;
  created_at: string;
  last_login_at?: string;
  post_count: number;
  follower_count: number;
  following_count: number;
  session_count: number;
}

export interface ActorListResult {
  total: number;
  page: number;
  items: ActorDetail[];
}

export interface ActorSession {
  session_id: string;
  device_type: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
  last_active_at: string;
  revoked: boolean;
  revoked_reason?: string;
}

/** List actors with pagination and optional search filter. */
export async function listActors(page = 1, pageSize = 20, search = ''): Promise<ActorListResult> {
  const { data } = await client.get<ActorListResult>('/actors', { params: { page, page_size: pageSize, search } });
  return data;
}

/** Get detailed information for a specific actor. */
export async function getActorDetail(ptid: string): Promise<ActorDetail> {
  const { data } = await client.get<ActorDetail>(`/actors/${encodeURIComponent(ptid)}`);
  return data;
}

/** List all sessions belonging to a specific actor. */
export async function getActorSessions(ptid: string): Promise<ActorSession[]> {
  const { data } = await client.get(`/actors/${encodeURIComponent(ptid)}/sessions`);
  return data.items;
}

/** Reset an actor's password (admin action). */
export async function resetActorPassword(ptid: string, newPassword: string): Promise<void> {
  await client.post(`/actors/${encodeURIComponent(ptid)}/reset-password`, { new_password: newPassword });
}

/** Revoke a specific session for an actor. */
export async function revokeActorSession(actorPTID: string, sessionId: string): Promise<void> {
  await client.post(`/actors/${encodeURIComponent(actorPTID)}/sessions/${encodeURIComponent(sessionId)}/revoke`);
}
