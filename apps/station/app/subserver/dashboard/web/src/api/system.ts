/**
 * System API — routes, subservers, audit logs, and session management.
 */

import client from './client';

export interface RouteInfo {
  name: string;
  path: string;
  method: string;
}

export interface AuditLog {
  id: number;
  admin_id: number;
  username: string;
  action: string;
  resource: string;
  detail: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

export interface PeersSession {
  session_id: string;
  user_id: number;
  device_type: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  expires_at: string;
  last_active_at: string;
}

export interface DashboardSession {
  session_id: string;
  admin_id: number;
  username: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  expires_at: string;
}

/** Fetch all registered API routes. */
export async function getSystemRoutes(): Promise<{ count: number; routes: RouteInfo[] }> {
  const { data } = await client.get('/system/routes');
  return data;
}

/** Fetch status of all sub-servers. */
export async function getSystemSubservers() {
  const { data } = await client.get('/system/subservers');
  return data;
}

/** Fetch general system information (version, uptime, etc.). */
export async function getSystemInfo() {
  const { data } = await client.get('/system/info');
  return data;
}

/** Fetch paginated audit logs. */
export async function getAuditLogs(page = 1, pageSize = 20): Promise<{ items: AuditLog[]; total: number; page: number }> {
  const { data } = await client.get('/audit-logs', { params: { page, page_size: pageSize } });
  return data;
}

/** Fetch all active Peers user sessions. */
export async function getActivePeersSessions(): Promise<{ count: number; items: PeersSession[] }> {
  const { data } = await client.get('/sessions/active');
  return data;
}

/** Revoke a specific Peers user session. */
export async function revokePeersSession(sessionId: string): Promise<void> {
  await client.post(`/sessions/${sessionId}/revoke`);
}

/** Fetch all active dashboard admin sessions. */
export async function getDashboardSessions(): Promise<{ count: number; items: DashboardSession[] }> {
  const { data } = await client.get('/dashboard-sessions');
  return data;
}

/** Revoke a specific dashboard admin session. */
export async function revokeDashboardSession(sessionId: string): Promise<void> {
  await client.post(`/dashboard-sessions/${sessionId}/revoke`);
}
