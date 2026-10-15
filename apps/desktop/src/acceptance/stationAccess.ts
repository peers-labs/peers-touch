import { api } from '../services/desktop_api';
import type { StationRouteCandidate } from '../services/desktop_api';

type StationAccessApi = Pick<
  typeof api,
  'stationAdd' | 'stationSetActive' | 'stationList'
>;

export interface AcceptanceStationBinding {
  configured: boolean;
  activeUrl: string | null;
  boundUrl: string | null;
  bindingPhase: string | null;
  online: boolean;
  peerIdAvailable: boolean;
  activeStationPeerId: string | null;
}

function normalizeStationUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\/+$/, '') ?? '';
  return normalized || null;
}

function freshestRoute(
  routes: StationRouteCandidate[],
): StationRouteCandidate | undefined {
  return routes.reduce<StationRouteCandidate | undefined>((selected, route) => {
    if (!selected) return route;
    const routeRank = [
      route.attestation_expires_at_unix_ms ?? 0,
      route.last_verified_at,
      route.route_generation,
      route.route_id,
    ] as const;
    const selectedRank = [
      selected.attestation_expires_at_unix_ms ?? 0,
      selected.last_verified_at,
      selected.route_generation,
      selected.route_id,
    ] as const;
    for (let index = 0; index < routeRank.length; index += 1) {
      if (routeRank[index] === selectedRank[index]) continue;
      return routeRank[index] > selectedRank[index] ? route : selected;
    }
    return selected;
  }, undefined);
}

export async function configureAcceptanceStation(
  stationApi: StationAccessApi,
  stationUrl: string,
): Promise<AcceptanceStationBinding> {
  const expectedUrl = normalizeStationUrl(stationUrl);
  if (!expectedUrl) {
    throw new Error('acceptance.stationAccess.stationUrlRequired');
  }

  const probed = await stationApi.stationAdd(expectedUrl);
  if (probed.entries.length !== 1) {
    throw new Error('acceptance.stationAccess.stationSelectionRequired');
  }
  const expectedRouteOrigin = normalizeStationUrl(probed.canonical_origin);
  const discoveredEntry = probed.entries[0];
  const availableRoutes = discoveredEntry?.routes.filter(
    (route) => route.health === 'available',
  ) ?? [];
  const discoveredRoute = freshestRoute(
    availableRoutes.filter(
      (route) => normalizeStationUrl(route.endpoint_origin) === expectedRouteOrigin,
    ),
  ) ?? (availableRoutes.length === 1 ? availableRoutes[0] : undefined);
  if (!discoveredEntry || !discoveredRoute || !expectedRouteOrigin) {
    throw new Error('acceptance.stationAccess.stationRouteRequired');
  }
  const selected = await stationApi.stationSetActive(
    discoveredEntry.station_peer_id,
    discoveredRoute.route_id,
  );
  const registry = await stationApi.stationList();
  const activeEntry = registry.entries.find(
    (entry) => entry.station_peer_id === registry.active_station_peer_id,
  );
  const activeRoute = activeEntry?.routes.find(
    (route) => route.route_id === activeEntry.active_route_id,
  );
  const activeUrl = normalizeStationUrl(activeRoute?.endpoint_origin);
  const boundUrl = selected.binding.active_route_id === activeRoute?.route_id
    ? activeUrl
    : null;
  const activeStationPeerId = activeEntry?.station_peer_id.trim() || null;
  const bindingPhase = selected.binding.phase ?? null;

  return {
    configured:
      activeUrl === expectedRouteOrigin
      && boundUrl === expectedRouteOrigin
      && bindingPhase === 'access_gate'
      && activeRoute?.health === 'available'
      && Boolean(activeStationPeerId),
    activeUrl,
    boundUrl,
    bindingPhase,
    online: activeRoute?.health === 'available',
    peerIdAvailable: Boolean(activeStationPeerId),
    activeStationPeerId,
  };
}

export const configureCurrentAcceptanceStation = (stationUrl: string) =>
  configureAcceptanceStation(api, stationUrl);
