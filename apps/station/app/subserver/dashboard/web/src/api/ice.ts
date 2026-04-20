import { log } from '../utils/logger';

export interface IceStats {
  peers: number;
  sessions: number;
  offers: number;
  answers: number;
  candidates: number;
  status: string;
}

export interface IcePeer {
  id: string;
  role: string;
  addrs: string[];
  updated_at: number;
}

export interface IceSession {
  id: string;
  a: string;
  b: string;
  created_at: number;
}

export interface IceSdpResult {
  sdp?: string;
}

export interface IceCandidateItem {
  id: string;
  candidate: string;
  mid?: string;
  mline?: number;
  from?: string;
}

export interface IceCandidatesResult {
  candidates?: IceCandidateItem[];
}

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(path, { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`request failed: ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

async function getJsonAllow404<T>(path: string): Promise<T | null> {
  const resp = await fetch(path, { method: 'GET' });
  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`request failed: ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export async function getIceStats(): Promise<IceStats> {
  try {
    return await getJson<IceStats>('/api/v1/ice/stats');
  } catch (error) {
    log.error('ice', 'Failed to load ICE stats', { error: String(error) });
    throw error;
  }
}

export async function getIcePeers(): Promise<IcePeer[]> {
  try {
    return await getJson<IcePeer[]>('/api/v1/ice/peers');
  } catch (error) {
    log.error('ice', 'Failed to load ICE peers', { error: String(error) });
    throw error;
  }
}

export async function getIceSessions(peer?: string): Promise<IceSession[]> {
  const query = peer ? `?peer=${encodeURIComponent(peer)}` : '';
  try {
    return await getJson<IceSession[]>(`/api/v1/ice/sessions${query}`);
  } catch (error) {
    log.error('ice', 'Failed to load ICE sessions', { error: String(error) });
    throw error;
  }
}

export async function getIceSession(id: string): Promise<IceSession | null> {
  try {
    return await getJsonAllow404<IceSession>(`/api/v1/ice/session/get?id=${encodeURIComponent(id)}`);
  } catch (error) {
    log.error('ice', 'Failed to load ICE session', { error: String(error) });
    throw error;
  }
}

export async function getIceOffer(id: string): Promise<IceSdpResult | null> {
  try {
    return await getJsonAllow404<IceSdpResult>(`/api/v1/ice/session/offer?id=${encodeURIComponent(id)}`);
  } catch (error) {
    log.error('ice', 'Failed to load ICE offer', { error: String(error) });
    throw error;
  }
}

export async function getIceAnswer(id: string): Promise<IceSdpResult | null> {
  try {
    return await getJsonAllow404<IceSdpResult>(`/api/v1/ice/session/answer?id=${encodeURIComponent(id)}`);
  } catch (error) {
    log.error('ice', 'Failed to load ICE answer', { error: String(error) });
    throw error;
  }
}

export async function getIceCandidates(id: string): Promise<IceCandidatesResult | null> {
  try {
    return await getJsonAllow404<IceCandidatesResult>(`/api/v1/ice/session/candidates?id=${encodeURIComponent(id)}`);
  } catch (error) {
    log.error('ice', 'Failed to load ICE candidates', { error: String(error) });
    throw error;
  }
}
