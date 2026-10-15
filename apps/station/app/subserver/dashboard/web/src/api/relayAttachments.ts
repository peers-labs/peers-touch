import client from './client';

export interface RelayInvitation {
  schema_version: number;
  relay_peer_id: string;
  control_origin: string;
  dial_addresses: string[];
  invite_token: string;
  intended_station_peer_id?: string;
  label?: string;
  max_clients?: number;
  bandwidth_limit?: number;
}

export type RelayAttachmentState =
  | 'attaching'
  | 'active'
  | 'recovering'
  | 'cleanup_pending'
  | 'detached';

export interface RelayAttachment {
  relay_peer_id: string;
  control_origin: string;
  dial_addresses: string[];
  label?: string;
  state: RelayAttachmentState;
  enabled: boolean;
  cleanup_pending: boolean;
  last_error?: string;
  route_generation?: number;
  route_expires_at?: string;
  credential_expires_at?: string;
  created_at: string;
  updated_at: string;
}

interface RelayAttachmentsResponse {
  items: RelayAttachment[];
}

export async function listRelayAttachments(): Promise<RelayAttachment[]> {
  const { data } = await client.get<RelayAttachmentsResponse>('/relay/attachments');
  return data.items || [];
}

export async function importRelayAttachment(
  invitation: RelayInvitation,
): Promise<RelayAttachment> {
  const { data } = await client.post<RelayAttachment>(
    '/relay/attachments',
    invitation,
  );
  return data;
}

export async function deleteRelayAttachment(
  relayPeerID: string,
): Promise<RelayAttachment> {
  const { data } = await client.delete<RelayAttachment>(
    `/relay/attachments/${encodeURIComponent(relayPeerID)}`,
  );
  return data;
}

export async function retryRelayAttachment(
  relayPeerID: string,
): Promise<RelayAttachment> {
  const { data } = await client.post<RelayAttachment>(
    `/relay/attachments/${encodeURIComponent(relayPeerID)}/retry`,
    {},
  );
  return data;
}
