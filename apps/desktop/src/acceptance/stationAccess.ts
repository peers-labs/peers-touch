import { api } from '../services/desktop_api';

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

export async function configureAcceptanceStation(
  stationApi: StationAccessApi,
  stationUrl: string,
): Promise<AcceptanceStationBinding> {
  const expectedUrl = normalizeStationUrl(stationUrl);
  if (!expectedUrl) {
    throw new Error('acceptance.stationAccess.stationUrlRequired');
  }

  const probed = await stationApi.stationAdd(expectedUrl);
  const selected = await stationApi.stationSetActive(expectedUrl);
  const registry = await stationApi.stationList();
  const activeUrl = normalizeStationUrl(registry.active_url);
  const boundUrl = normalizeStationUrl(selected.binding.bound_url);
  const activeEntry = registry.entries.find(
    (entry) => normalizeStationUrl(entry.url) === expectedUrl,
  );
  const activeStationPeerId = (
    activeEntry?.peer_id?.trim() || probed.peer_id?.trim() || null
  );
  const bindingPhase = selected.binding.phase ?? null;

  return {
    configured:
      activeUrl === expectedUrl
      && boundUrl === expectedUrl
      && bindingPhase === 'access_gate'
      && activeEntry?.online === true
      && Boolean(activeStationPeerId),
    activeUrl,
    boundUrl,
    bindingPhase,
    online: activeEntry?.online === true,
    peerIdAvailable: Boolean(activeStationPeerId),
    activeStationPeerId,
  };
}

export const configureCurrentAcceptanceStation = (stationUrl: string) =>
  configureAcceptanceStation(api, stationUrl);
