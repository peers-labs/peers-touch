/**
 * Dashboard admin management API — create, list, enable/disable admin accounts.
 */

import client from './client';
import type { AdminInfo } from './auth';

export interface CreateAdminRequest {
  username: string;
  password: string;
  display_name: string;
  did?: string;
}

export interface DashboardAdmin {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_super_user: boolean;
  did: string;
  disabled: boolean;
  last_login_at?: string;
  last_login_ip?: string;
  created_at: string;
}

/** Create a new dashboard admin account. */
export async function createAdmin(req: CreateAdminRequest): Promise<AdminInfo> {
  const { data } = await client.post<AdminInfo>('/admins', req);
  return data;
}

/** List all dashboard admin accounts. */
export async function listAdmins(): Promise<DashboardAdmin[]> {
  const { data } = await client.get('/admins');
  return data.items;
}

/** Disable a dashboard admin account. */
export async function disableAdmin(id: number): Promise<void> {
  await client.post(`/admins/${id}/disable`);
}

/** Re-enable a previously disabled admin account. */
export async function enableAdmin(id: number): Promise<void> {
  await client.post(`/admins/${id}/enable`);
}

/** Permanently delete a dashboard admin account. */
export async function deleteAdmin(id: number): Promise<void> {
  await client.delete(`/admins/${id}`);
}
