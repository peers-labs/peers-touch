export const STATION_ACTIVE_CHANGED_EVENT = 'peers-touch:station-active-changed';

export interface StationActiveChangedDetail {
  stationPeerId: string;
  routeId: string;
  displayName?: string;
}

export function dispatchStationActiveChanged(detail: StationActiveChangedDetail) {
  window.dispatchEvent(new CustomEvent<StationActiveChangedDetail>(STATION_ACTIVE_CHANGED_EVENT, { detail }));
}
