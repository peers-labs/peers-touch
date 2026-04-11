/**
 * Overview API — fetches aggregated dashboard statistics and recent activity.
 *
 * Changed: 2026-04-10 — Removed fake fields (sessions, storage, version,
 *   node_name, nodes.online) from OverviewStats type. Only real data.
 */

import client from './client';

export interface OverviewStats {
  actors: { total: number; active: number; new_today: number; new_this_week: number };
  nodes: { registered: number };
  sub_servers: { total: number; running: number; stopped: number; list: SubServerInfo[] };
  social: { total_posts: number; total_comments: number; total_likes: number; total_follows: number; posts_today: number };
  system: { started_at: string; go_version: string; listen_addr: string };
}

export interface SubServerInfo {
  name: string;
  type: string;
  status: string;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const { data } = await client.get<OverviewStats>('/overview/stats');
  return data;
}

export async function getRecentActors(limit = 10) {
  const { data } = await client.get('/overview/recent-actors', { params: { limit } });
  return data.items;
}

export async function getRecentAuditLogs(limit = 10) {
  const { data } = await client.get('/overview/recent-audit-logs', { params: { limit } });
  return data.items;
}
