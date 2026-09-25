import { create, fromBinary, toBinary } from '@bufbuild/protobuf';

import {
  verifyStationIdentityProof,
  type VerifiedStationIdentity,
} from '../../services/mobileCommands';
import {
  StationIdentityRequestSchema,
  StationIdentityResponseSchema,
} from '../../gen/proto/domain/peer/station_identity_pb';

const REQUIRED_STATION_CAPABILITIES = [
  'access-gate',
  'actor-ptid',
  'station-identity',
] as const;

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

export async function verifyStationIdentity(url: string): Promise<StationIdentityResult> {
  const requestedOrigin = canonicalOrigin(url);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const request = create(StationIdentityRequestSchema, { challenge });
  const response = await fetch(`${requestedOrigin}/sub-bootstrap/station-identity`, {
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    headers: {
      Accept: 'application/x-protobuf',
      'Content-Type': 'application/x-protobuf',
    },
    body: toBinary(StationIdentityRequestSchema, request),
  });
  if (!response.ok) {
    throw new Error('mobile.launch.stationIdentityUnavailable');
  }

  const proof = fromBinary(
    StationIdentityResponseSchema,
    new Uint8Array(await response.arrayBuffer()),
  );
  const verified = await verifyStationIdentityProof({
    requestedOrigin,
    challenge: Array.from(challenge),
    statementBytes: Array.from(proof.statementBytes),
    hostPublicKey: Array.from(proof.hostPublicKey),
    signature: Array.from(proof.signature),
    requiredCapabilities: [...REQUIRED_STATION_CAPABILITIES],
  });
  if (!verified.stationPeerId.trim() || !verified.canonicalOrigin.trim()) {
    throw new Error('mobile.launch.stationIdentityInvalid');
  }
  return {
    stationPeerId: verified.stationPeerId.trim(),
    canonicalOrigin: verified.canonicalOrigin.replace(/\/+$/, ''),
    verifiedAt: verified.verifiedAt,
    identityVerified: true,
  };
}

function canonicalOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('mobile.launch.stationIdentityInvalid');
  }
  return parsed.origin;
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
