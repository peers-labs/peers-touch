import { controlPlanePost } from './client';

export interface Federation {
  federation_id: string;
  name: string;
  description: string;
  status: string;
  sequencer_station_peer_id: string;
  member_station_count: number;
  head_seq: string | number;
  my_role: string;
  capability?: { can_leave: boolean; can_archive: boolean };
}
export interface MemberStation {
  station_peer_id: string;
  station_name: string;
  station_url: string;
  status: string;
  sync_status: string;
}
export const federation = {
  list: () => controlPlanePost<{ federations: Federation[] }>('/federation/list'),
  stations: (federation_id: string) => controlPlanePost<{ stations: MemberStation[] }>('/federation/stations', { federation_id }),
  create: (name: string, description: string) => controlPlanePost('/federation/create', { name, description, policy_type: 'single_admin' }),
  join: (federation_id: string, federation_endpoint: string) => controlPlanePost('/federation/join', { federation_id, federation_endpoint }),
  leave: (federation_id: string) => controlPlanePost('/federation/leave', { federation_id }),
  remove: (federation_id: string) => controlPlanePost('/federation/delete', { federation_id }),
};
