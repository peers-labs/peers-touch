import {
  api,
  type LocalStationCandidate,
  type StationEntry,
  type StationRouteCandidate,
  type XConfigSuggestion,
} from './desktop_api';
import { getXConfigProjection } from './xConfig';
import { log } from '../utils/logger';

// Single aggregation owner for the Station candidate catalog (NCP-D22).
// Rust owns local env parsing and the verified registry; this module is the
// only place that merges the three tiers, dedups and orders them.

export type StationCandidateSource = 'environment' | 'injected' | 'xconfig';

export type StationCandidateState = 'verified' | 'suggestion';

export interface StationCandidate {
  id: string;
  // Only suggestions carry a source tier; verified entries outrank sources.
  source?: StationCandidateSource;
  state: StationCandidateState;
  canonicalOrigin: string;
  displayName: string;
  // Present only for xconfig suggestions; local tiers activate via station_add.
  seedId?: string;
  // False suggestions are rendered but cannot be activated.
  actionable: boolean;
}

export interface StationCandidateCatalog {
  verified: StationCandidate[];
  suggestions: StationCandidate[];
  activeStationPeerId: string | null;
}

// Proximity order: the most local, most specific configuration wins ordering.
const SOURCE_PRIORITY: Record<StationCandidateSource, number> = {
  environment: 0,
  injected: 1,
  xconfig: 2,
};

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

function activeOrigin(entry: StationEntry): string | null {
  const route = entry.routes.find((candidate) => candidate.route_id === entry.active_route_id);
  return route ? normalizeOrigin(route.endpoint_origin) : null;
}

interface BuildInput {
  verifiedEntries: StationEntry[];
  activeStationPeerId: string | null;
  localCandidates: LocalStationCandidate[];
  xconfigSuggestions: XConfigSuggestion[];
}

export function buildStationCandidateCatalog({
  verifiedEntries,
  activeStationPeerId,
  localCandidates,
  xconfigSuggestions,
}: BuildInput): StationCandidateCatalog {
  const verified: StationCandidate[] = [];
  const verifiedOrigins = new Set<string>();

  for (const entry of verifiedEntries) {
    const origin = activeOrigin(entry);
    if (origin) verifiedOrigins.add(origin);
    verified.push({
      id: `verified:${entry.station_peer_id}`,
      state: 'verified',
      canonicalOrigin: origin ?? '',
      displayName: entry.display_name || entry.station_peer_id,
      actionable: true,
    });
  }

  // Tier-ordered inputs; first occurrence of an origin owns its source label.
  const tiered: Array<Omit<StationCandidate, 'state' | 'id'> & { seedId?: string }> = [
    ...localCandidates.map((candidate) => ({
      source: candidate.source,
      canonicalOrigin: normalizeOrigin(candidate.canonical_origin),
      displayName: normalizeOrigin(candidate.canonical_origin),
      actionable: true,
    })),
    ...xconfigSuggestions
      .filter((suggestion) => suggestion.kind === 'direct_station')
      .map((suggestion) => ({
        source: 'xconfig' as const,
        canonicalOrigin: normalizeOrigin(suggestion.canonical_origin),
        displayName: suggestion.display_name || suggestion.canonical_origin,
        seedId: suggestion.seed_id,
        actionable: suggestion.actionable,
      })),
  ].sort((left, right) => SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source]);

  const suggestions: StationCandidate[] = [];
  const seenOrigins = new Set<string>();

  for (const candidate of tiered) {
    if (!candidate.canonicalOrigin || seenOrigins.has(candidate.canonicalOrigin)) {
      continue;
    }
    seenOrigins.add(candidate.canonicalOrigin);
    if (verifiedOrigins.has(candidate.canonicalOrigin)) {
      continue;
    }
    suggestions.push({
      ...candidate,
      id: candidate.seedId ?? `${candidate.source}:${candidate.canonicalOrigin}`,
      state: 'suggestion',
    });
  }

  return { verified, suggestions, activeStationPeerId };
}

export async function loadStationCandidateCatalog(): Promise<StationCandidateCatalog> {
  const [registry, local] = await Promise.all([
    api.stationList(),
    api.stationLocalCandidates(),
  ]);
  // Read the already-loaded projection snapshot; never block on a cloud fetch.
  const projection = getXConfigProjection();

  return buildStationCandidateCatalog({
    verifiedEntries: registry.entries ?? [],
    activeStationPeerId: registry.active_station_peer_id ?? null,
    localCandidates: local.candidates ?? [],
    xconfigSuggestions: projection.suggestions ?? [],
  });
}

/**
 * Pick the route to activate for a verified entry. Direct routes win over
 * relay/circuit; healthy routes win over degraded ones. Relative order within
 * the same tier is preserved. Returns null only when the entry has no route.
 */
export function pickActivationRoute(entry: StationEntry): StationRouteCandidate | null {
  const healthy = entry.routes.filter((route) => route.health === 'available');
  const pool = healthy.length > 0 ? healthy : entry.routes;
  const direct = pool.filter((route) => route.route_type === 'direct');
  if (direct.length > 0) return direct[0] ?? null;
  const relay = pool.filter((route) => route.route_type === 'relay');
  return relay[0] ?? null;
}

function findEntryByOrigin(entries: StationEntry[], origin: string): StationEntry | undefined {
  return entries.find((entry) =>
    entry.routes.some((route) => normalizeOrigin(route.endpoint_origin) === origin),
  );
}

export type DevStationActivationOutcome =
  | 'already-active'
  | 'activated'
  | 'skipped'
  | 'failed';

let devActivationInFlight: Promise<DevStationActivationOutcome> | null = null;

/**
 * Dev-only convenience: when the local development controller injects a
 * Profile Station (`environment` tier, absent from packaged builds), verify
 * and activate it automatically so test accounts can sign in without a manual
 * pick. Signed discovery still runs and only verified routes are activated;
 * injected/xconfig tiers and production builds are never auto-selected
 * (NCP-D24). Idempotent and non-blocking: failures are logged, not thrown.
 */
export function ensureDevStationActive(): Promise<DevStationActivationOutcome> {
  if (!devActivationInFlight) {
    devActivationInFlight = runEnsureDevStationActive().finally(() => {
      devActivationInFlight = null;
    });
  }
  return devActivationInFlight;
}

async function runEnsureDevStationActive(): Promise<DevStationActivationOutcome> {
  // The Profile channel only exists in development; the DEV guard also makes
  // the production bundle eliminate this path.
  if (!import.meta.env.DEV) return 'skipped';
  try {
    const registry = await api.stationList();
    if (registry.active_station_peer_id?.trim()) return 'already-active';

    const local = await api.stationLocalCandidates();
    const profileCandidate = (local.candidates ?? []).find(
      (candidate: LocalStationCandidate) => candidate.source === 'environment',
    );
    if (!profileCandidate) return 'skipped';
    const targetOrigin = normalizeOrigin(profileCandidate.canonical_origin);

    // Always re-run signed discovery instead of reusing a persisted entry:
    // a stored route can carry an expired attestation, which stationSetActive
    // rejects. stationAdd is an idempotent verify-and-store that refreshes
    // route health and attestation against the live Station.
    const discovered = await api.stationAdd(targetOrigin);
    const entry = findEntryByOrigin(discovered.entries ?? [], targetOrigin)
      ?? discovered.entries?.[0];
    if (!entry) return 'failed';

    const route = pickActivationRoute(entry);
    if (!route) return 'failed';

    await api.stationSetActive(entry.station_peer_id, route.route_id);
    return 'activated';
  } catch (error) {
    log.warn('stationCandidates', 'dev station auto-activation failed', { error });
    return 'failed';
  }
}
