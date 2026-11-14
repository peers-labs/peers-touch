/**
 * Authentication API functions for login, logout, and session management.
 */

import client, { controlPlanePost, getAuthEpoch, setAuthToken } from './client';

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

let loginRequest = 0;
/** Authenticate with username/password and store the returned token. */
export async function login(req: LoginRequest): Promise<LoginResult> {
  const request = ++loginRequest;
  const epoch = getAuthEpoch();
  const { data } = await client.post<LoginResult>('/auth/login', req);
  if (request !== loginRequest || epoch !== getAuthEpoch()) throw new Error('Dashboard account changed');
  setAuthToken(data.token);
  return data;
}

/** Invalidate the current session and clear local token. */
export async function logout(): Promise<void> {
  loginRequest++;
  const epoch = getAuthEpoch();
  await controlPlanePost('/auth/logout');
  if (epoch === getAuthEpoch()) setAuthToken(null);
}

/** Fetch the currently authenticated admin's profile. */
export async function getMe(): Promise<AdminInfo> {
  const { data } = await client.get<AdminInfo>('/auth/me');
  return data;
}

/** Change the current admin's password (requires re-login after success). */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await controlPlanePost('/auth/change-password', { old_password: oldPassword, new_password: newPassword });
  setAuthToken(null);
}
