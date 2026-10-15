import {
  activateStationRouteBinding,
  discoverStationEndpoint,
  fetchActiveStationIdentity,
  readStationRouteBinding,
  restoreStationRouteBinding,
  type NativeStationRouteCandidate,
  type StationEndpointDiscovery,
  type VerifiedStationIdentity,
} from '../../services/mobileCommands';

export interface StationProbeResult {
  url: string;
  online: boolean;
  label?: string;
  checkedAt: number;
  error?: string;
}

export interface StationIdentityResult {
  stationPeerId: string;
  canonicalOrigin: string;
  verifiedAt: number;
  identityVerified: boolean;
  routeId: string;
  routeType: 'direct' | 'relay';
}

export interface ConnectedStationIdentity extends StationIdentityResult {
  route: NativeStationRouteCandidate;
}

// Probe the station via an actual HTTP(S) request. This validates the full
// protocol stack (TLS handshake for HTTPS, HTTP response for HTTP), so a
// misconfigured protocol (e.g. HTTPS to an HTTP-only port) correctly fails.
export async function probeStation(url: string): Promise<StationProbeResult> {
  const baseUrl = url.replace(/\/+$/, '');
  const checkedAt = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Use a lightweight POST to /actor/access/start with minimal body.
    // Any HTTP-level response (even 4xx/5xx) means the station is reachable.
    const response = await fetch(`${baseUrl}/actor/access/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station_url: baseUrl, client: { platform: 'probe' } }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Station responded at HTTP level — it's online
    const label = await extractLabelFromResponse(response, baseUrl);
    return { url: baseUrl, online: true, label, checkedAt };
  } catch (err) {
    // Network error, TLS failure, timeout — station is unreachable via this URL
    const raw = err instanceof Error ? err.message : String(err);
    // iOS WKWebView often returns opaque messages like "Load failed".
    // Enrich with the URL and protocol context to help the user diagnose.
    const detail = `${baseUrl} → ${raw}`;
    return { url: baseUrl, online: false, label: extractStationLabel(baseUrl), checkedAt, error: detail };
  }
}

export async function verifyStationIdentity(url: string): Promise<ConnectedStationIdentity> {
  const discovery = await discoverStationConnection(url);
  if (discovery.routes.length !== 1) {
    throw new Error('mobile.launch.stationRouteSelectionRequired');
  }
  return activateAndVerifyStationRoute(discovery.routes[0], 1);
}

export async function discoverStationConnection(
  input: string,
): Promise<StationEndpointDiscovery> {
  const value = input.trim();
  if (!value) throw new Error('mobile.launch.stationIdentityInvalid');
  const discovery = await discoverStationEndpoint(value);
  if (!discovery.routes.length) {
    throw new Error('mobile.launch.stationRouteUnavailable');
  }
  return discovery;
}

export async function activateAndVerifyStationRoute(
  route: NativeStationRouteCandidate,
  routeRevision: number,
): Promise<ConnectedStationIdentity> {
  const binding = await activateStationRouteBinding({
    stationPeerId: route.stationPeerId,
    routeId: route.routeId,
    routeRevision,
  });
  const verified = await fetchActiveStationIdentity();
  return {
    ...requireRouteIdentity(binding.stationPeerId, binding.routeId, verified),
    route,
  };
}

export async function restoreAndVerifyStationRoute(input: {
  stationPeerId: string;
  routeId: string;
  routeGeneration: number;
  routeRevision: number;
  sourceRef: string;
  endpointOrigin: string;
}): Promise<StationIdentityResult> {
  const binding = await restoreStationRouteBinding(input);
  const verified = await fetchActiveStationIdentity();
  return requireRouteIdentity(binding.stationPeerId, binding.routeId, verified);
}

export async function verifyBoundStationRoute(input: {
  stationPeerId: string;
  routeId: string;
  routeGeneration: number;
  routeRevision: number;
  sourceRef: string;
  endpointOrigin: string;
}): Promise<StationIdentityResult> {
  const current = await readStationRouteBinding();
  if (
    current?.stationPeerId === input.stationPeerId
    && current.routeId === input.routeId
    && current.routeGeneration === input.routeGeneration
    && current.routeRevision === input.routeRevision
  ) {
    return requireRouteIdentity(
      current.stationPeerId,
      current.routeId,
      await fetchActiveStationIdentity(),
    );
  }
  return restoreAndVerifyStationRoute(input);
}

function requireRouteIdentity(
  stationPeerId: string,
  routeId: string,
  verified: VerifiedStationIdentity,
): StationIdentityResult {
  if (
    !verified.stationPeerId.trim()
    || !verified.canonicalOrigin.trim()
    || verified.stationPeerId !== stationPeerId
    || verified.routeId !== routeId
  ) {
    throw new Error('mobile.launch.stationIdentityInvalid');
  }
  return {
    stationPeerId: verified.stationPeerId.trim(),
    canonicalOrigin: verified.canonicalOrigin.replace(/\/+$/, ''),
    verifiedAt: verified.verifiedAt,
    identityVerified: true,
    routeId,
    routeType: verified.routeType ?? 'direct',
  };
}

async function extractLabelFromResponse(response: Response, fallbackUrl: string): Promise<string> {
  try {
    const data = await response.json();
    // The access/start response may contain station info in the future
    if (data?.data?.station_label) return data.data.station_label;
  } catch {
    // ignore parse errors
  }
  return extractStationLabel(fallbackUrl);
}

function extractStationLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.port ? `:${parsed.port}` : '');
  } catch {
    return url;
  }
}
