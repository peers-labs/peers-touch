/**
 * Nodes API — persisted peers (touch_peer + touch_peer_address) and live
 * registry registrations.
 */

import client from './client';

export interface PeerAddressInfo {
  type: string;
  addr: string;
}

export interface PersistedPeer {
  id: number;
  peer_id: string;
  name: string;
  version: string;
  addresses: PeerAddressInfo[];
  created_at: string;
  updated_at: string;
}

export interface RegistryRegistration {
  id: string;
  name: string;
  type: string;
  namespaces: string[];
  addresses: string[];
  ttl_seconds?: number;
  metadata?: Record<string, string>;
}

export interface NodesOverview {
  persisted: PersistedPeer[];
  registrations: RegistryRegistration[];
}

export async function getNodesOverview(): Promise<NodesOverview> {
  const { data } = await client.get<NodesOverview>('/nodes');
  return data;
}
