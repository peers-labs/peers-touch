/**
 * Authentication API functions for login, logout, and session management.
 */

import client, { setAuthToken } from './client';

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  session_id: string;
  expires_at: string;
  admin: AdminInfo;
}

export interface AdminInfo {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_super_user: boolean;
}

/** Authenticate with username/password and store the returned token. */
export async function login(req: LoginRequest): Promise<LoginResult> {
  const { data } = await client.post<LoginResult>('/auth/login', req);
  setAuthToken(data.token);
  return data;
}

/** Invalidate the current session and clear local token. */
export async function logout(): Promise<void> {
  await client.post('/auth/logout');
  setAuthToken(null);
}

/** Fetch the currently authenticated admin's profile. */
export async function getMe(): Promise<AdminInfo> {
  const { data } = await client.get<AdminInfo>('/auth/me');
  return data;
}

/** Change the current admin's password (requires re-login after success). */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await client.post('/auth/change-password', { old_password: oldPassword, new_password: newPassword });
  setAuthToken(null);
}
