import {
  api,
  type LocalStationCandidate,
  type StationEntry,
  type XConfigSuggestion,
} from './desktop_api';
import { getXConfigProjection } from './xConfig';

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
