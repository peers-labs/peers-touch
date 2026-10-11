import { createMobileAppStorageRuntime } from '../../storage/mobileClientStorage';
import type { NativeStationRouteCandidate, StationRouteType } from '../../services/mobileCommands';

export type StationProtocol = 'https' | 'http';

export interface MobileStationEntry {
  stationPeerId: string;
  url: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  lastCheckedAt?: number;
  online?: boolean;
  identityVerified?: boolean;
  pinnedStationRootPublicKey?: number[];
  routes?: MobileStationRouteCandidate[];
  activeRouteId?: string;
  routeRevision?: number;
  lifecycleGeneration?: number;
}

export interface MobileStationRouteCandidate {
  nodePeerId: string;
  nodeAuthorizationDigest: number[];
  authorizationEpoch: number;
  routeId: string;
  routeType: StationRouteType;
  transport: 'direct_https' | 'libp2p_http_v1';
  endpointOrigin: string;
  relayPeerId?: string;
  routeGeneration: number;
  innerTlsSpkiSha256?: number[];
  addresses: string[];
  attestationBytes?: number[];
  attestationExpiresAtUnixMs?: number;
  sourceRef: string;
  lastVerifiedAt: number;
  lastSuccessAt?: number;
  health: 'available' | 'degraded' | 'unavailable' | 'revoked';
}

export interface StoredStationRegistry {
  activeStationPeerId: string;
  entries: MobileStationEntry[];
}

export interface StationStatusInput {
  label?: string;
  online?: boolean;
  checkedAt?: number;
}

export interface VerifiedStationInput {
  stationPeerId: string;
  url: string;
}

export interface VerifiedStationRouteInput {
  identity: VerifiedStationInput;
  stationRootPublicKey: number[];
  route: NativeStationRouteCandidate;
}

const STATION_REGISTRY_KEY = 'peers-touch.mobile.station-registry.v3';

export async function loadStationRegistry(): Promise<StoredStationRegistry> {
  const repository = createMobileAppStorageRuntime().repositories.stationRegistry;
  try {
    const parsed = await repository.readValue(
      STATION_REGISTRY_KEY,
    ) as Partial<StoredStationRegistry> | null;
    if (!parsed) return createEmptyStationRegistry();
    const registry = parseStoredStationRegistry(parsed);
    if (!registry) {
      await repository.remove(STATION_REGISTRY_KEY);
      return createEmptyStationRegistry();
    }
    return registry;
  } catch {
    return createEmptyStationRegistry();
  }
}

export async function persistStationRegistry(registry: StoredStationRegistry): Promise<void> {
  await createMobileAppStorageRuntime().repositories.stationRegistry.write(STATION_REGISTRY_KEY, registry);
}

export function emptyStationRegistry(): StoredStationRegistry {
  return createEmptyStationRegistry();
}

export function parseStoredStationRegistry(value: unknown): StoredStationRegistry | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Partial<StoredStationRegistry>;
  if (!isStoredStationRegistry(parsed)) return null;
  const entries = parsed.entries.map(normalizeStationEntry).sort(compareRecentlyUsed);
  return {
    activeStationPeerId: entries.some((entry) => entry.stationPeerId === parsed.activeStationPeerId)
      ? parsed.activeStationPeerId
      : entries[0]?.stationPeerId ?? '',
    entries,
  };
}

export function addStationRoute(
  registry: StoredStationRegistry,
  input: VerifiedStationRouteInput,
  status: StationStatusInput = {},
): { ok: true; registry: StoredStationRegistry } | { ok: false; error: string } {
  const stationPeerId = input.identity.stationPeerId.trim();
  const canonicalOrigin = normalizeVerifiedStationUrl(input.identity.url);
  const route = normalizeRouteCandidate(input.route);
  if (
    !stationPeerId
    || !canonicalOrigin
    || !route
    || input.route.stationPeerId.trim() !== stationPeerId
    || input.stationRootPublicKey.length === 0
    || !equalBytes(input.stationRootPublicKey, input.route.stationRootPublicKey)
  ) {
    return { ok: false, error: 'mobile.launch.stationIdentityInvalid' };
  }
  const existing = registry.entries.find((entry) => entry.stationPeerId === stationPeerId);
  if (
    existing?.pinnedStationRootPublicKey?.length
    && !equalBytes(existing.pinnedStationRootPublicKey, input.stationRootPublicKey)
  ) {
    return { ok: false, error: 'mobile.launch.stationIdentityMismatch' };
  }
  if (route.routeType === 'direct') {
    const conflictingDirect = registry.entries.find((entry) => (
      entry.stationPeerId !== stationPeerId
      && stationRoutes(entry).some((candidate) => (
        candidate.routeType === 'direct'
        && candidate.endpointOrigin === route.endpointOrigin
      ))
    ));
    if (conflictingDirect) {
      return { ok: false, error: 'mobile.launch.stationIdentityMismatch' };
    }
  }

  const now = Date.now();
  const currentRoutes = existing ? stationRoutes(existing) : [];
  const routes = [
    route,
    ...currentRoutes.filter((candidate) => candidate.routeId !== route.routeId),
  ];
  const nextEntry = applyStationStatus({
    stationPeerId,
    url: canonicalOrigin,
    label: existing?.label || extractStationLabel(canonicalOrigin),
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now,
    identityVerified: true,
    pinnedStationRootPublicKey: [...input.stationRootPublicKey],
    routes,
    activeRouteId: route.routeId,
    routeRevision: existing
      ? Math.max(1, existing.routeRevision ?? 1) + (
        activeStationRoute(existing)?.routeId === route.routeId ? 0 : 1
      )
      : 1,
    lifecycleGeneration: existing?.lifecycleGeneration ?? 1,
  }, status);

  return {
    ok: true,
    registry: {
      activeStationPeerId: stationPeerId,
      entries: [
        nextEntry,
        ...registry.entries.filter((entry) => entry.stationPeerId !== stationPeerId),
      ].sort(compareRecentlyUsed),
    },
  };
}

export function activateStationEntry(
  registry: StoredStationRegistry,
  stationPeerId: string,
  status: StationStatusInput = {},
): StoredStationRegistry {
  if (!registry.entries.some((entry) => entry.stationPeerId === stationPeerId)) return registry;

  const now = Date.now();
  const stationChanged = Boolean(
    registry.activeStationPeerId
    && registry.activeStationPeerId !== stationPeerId,
  );
  const entries = registry.entries
    .map((entry) => (
      entry.stationPeerId === stationPeerId
        ? applyStationStatus({
            ...entry,
            lastUsedAt: now,
            lifecycleGeneration: stationChanged
              ? (entry.lifecycleGeneration ?? 1) + 1
              : entry.lifecycleGeneration ?? 1,
          }, status)
        : entry
    ))
    .sort(compareRecentlyUsed);

  return { activeStationPeerId: stationPeerId, entries };
}

export function activateStationRoute(
  registry: StoredStationRegistry,
  stationPeerId: string,
  routeId: string,
): StoredStationRegistry {
  let changed = false;
  const entries = registry.entries.map((entry) => {
    if (entry.stationPeerId !== stationPeerId) return entry;
    const route = stationRoutes(entry).find((candidate) => candidate.routeId === routeId);
    if (!route || route.health === 'revoked' || route.health === 'unavailable') return entry;
    if (activeStationRoute(entry)?.routeId === routeId) return entry;
    changed = true;
    return {
      ...entry,
      activeRouteId: routeId,
      routeRevision: Math.max(1, entry.routeRevision ?? 1) + 1,
      lastUsedAt: Date.now(),
    };
  });
  return changed ? { ...registry, activeStationPeerId: stationPeerId, entries } : registry;
}

export function updateStationEntryStatus(
  registry: StoredStationRegistry,
  stationPeerId: string,
  status: StationStatusInput,
): StoredStationRegistry {
  let changed = false;
  const entries = registry.entries.map((entry) => {
    if (entry.stationPeerId !== stationPeerId) return entry;

    const next = applyStationStatus(entry, status);
    const entryChanged = !isSameStationEntry(entry, next);
    if (entryChanged) changed = true;
    return entryChanged ? next : entry;
  });

  return changed ? { ...registry, entries } : registry;
}

export function removeStationEntry(registry: StoredStationRegistry, stationPeerId: string): StoredStationRegistry {
  const entries = registry.entries.filter((entry) => entry.stationPeerId !== stationPeerId);
  if (entries.length === registry.entries.length) return registry;

  const activeStationPeerId = registry.activeStationPeerId === stationPeerId
    ? entries[0]?.stationPeerId ?? ''
    : registry.activeStationPeerId;
  return { activeStationPeerId, entries };
}

export function replaceStationEntryIdentity(
  registry: StoredStationRegistry,
  expectedStationPeerId: string,
  input: VerifiedStationInput,
  status: StationStatusInput = {},
): { ok: true; registry: StoredStationRegistry } | { ok: false; error: string } {
  const stationPeerId = input.stationPeerId.trim();
  const normalized = normalizeVerifiedStationUrl(input.url);
  const existing = registry.entries.find(
    (entry) => entry.stationPeerId === expectedStationPeerId,
  );
  if (
    !stationPeerId
    || !normalized
    || !existing
    || normalizeVerifiedStationUrl(existing.url) !== normalized
  ) {
    return { ok: false, error: 'mobile.launch.stationIdentityInvalid' };
  }

  const now = Date.now();
  const replacement = applyStationStatus({
    stationPeerId,
    url: normalized,
    label: extractStationLabel(normalized),
    createdAt: now,
    lastUsedAt: now,
    identityVerified: true,
  }, status);

  return {
    ok: true,
    registry: {
      activeStationPeerId: stationPeerId,
      entries: [
        replacement,
        ...registry.entries.filter(
          (entry) => (
            entry.stationPeerId !== expectedStationPeerId
            && entry.stationPeerId !== stationPeerId
          ),
        ),
      ].sort(compareRecentlyUsed),
    },
  };
}

export function activeStationEntry(registry: StoredStationRegistry): MobileStationEntry | null {
  return registry.entries.find((entry) => entry.stationPeerId === registry.activeStationPeerId) ?? null;
}

export function stationRoutes(entry: MobileStationEntry): MobileStationRouteCandidate[] {
  return entry.routes ?? [];
}

export function activeStationRoute(
  entry: MobileStationEntry,
): MobileStationRouteCandidate | null {
  const routes = stationRoutes(entry);
  return routes.find((route) => route.routeId === entry.activeRouteId) ?? routes[0] ?? null;
}

export function stationEntryAtUrl(
  registry: StoredStationRegistry,
  url: string,
): MobileStationEntry | null {
  const normalized = normalizeVerifiedStationUrl(url);
  if (!normalized) return null;
  return registry.entries.find(
    (entry) => normalizeVerifiedStationUrl(entry.url) === normalized,
  ) ?? null;
}

export function requireMatchingStationIdentity(
  entry: MobileStationEntry,
  verifiedStationPeerId: string,
): MobileStationEntry {
  if (entry.stationPeerId !== verifiedStationPeerId.trim()) {
    throw new Error('mobile.launch.stationIdentityMismatch');
  }
  return entry;
}

export function buildStationUrl(value: string): string | null {
  const address = normalizeStationAddress(value);
  if (!address) return null;

  try {
    const url = new URL(address);
    if (!isRootHttpOrigin(url)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildStationAccessInput(value: string): string | null {
  const raw = value.trim();
  if (raw.startsWith('ptc1:') || raw.startsWith('peers-touch://connect#')) {
    return raw;
  }
  return buildStationUrl(raw);
}

function createEmptyStationRegistry(): StoredStationRegistry {
  return { activeStationPeerId: '', entries: [] };
}

function normalizeStationEntry(entry: MobileStationEntry): MobileStationEntry {
  const routes = stationRoutes(entry)
    .map(normalizeRouteCandidate)
    .filter((route): route is MobileStationRouteCandidate => route !== null);
  const activeRouteId = routes.some((route) => route.routeId === entry.activeRouteId)
    ? entry.activeRouteId!
    : routes[0]?.routeId ?? '';
  return {
    ...entry,
    routes,
    activeRouteId,
    routeRevision: Math.max(1, entry.routeRevision ?? 1),
    lifecycleGeneration: Math.max(1, entry.lifecycleGeneration ?? 1),
  };
}

function normalizeRouteCandidate(
  value: NativeStationRouteCandidate | MobileStationRouteCandidate,
): MobileStationRouteCandidate | null {
  const routeId = value.routeId?.trim();
  const nodePeerId = value.nodePeerId?.trim();
  const endpointOrigin = normalizeVerifiedStationUrl(value.endpointOrigin);
  const transportValid = (
    (value.routeType === 'direct' && value.transport === 'direct_https')
    || (value.routeType === 'relay' && value.transport === 'libp2p_http_v1')
  );
  const addresses = value.addresses
    ?.map((address) => address.trim())
    .filter(Boolean) ?? [];
  if (
    !routeId
    || !nodePeerId
    || !endpointOrigin
    || !['direct', 'relay'].includes(value.routeType)
    || !transportValid
    || value.nodeAuthorizationDigest?.length !== 32
    || !Number.isSafeInteger(value.authorizationEpoch)
    || value.authorizationEpoch < 1
    || !Number.isSafeInteger(value.routeGeneration)
    || value.routeGeneration < 1
    || addresses.length === 0
    || (
      value.routeType === 'relay'
      && (
        value.innerTlsSpkiSha256?.length !== 32
        || !addresses.some((address) => address.includes('/p2p-circuit/'))
      )
    )
  ) {
    return null;
  }
  const health = 'health' in value
    && ['available', 'degraded', 'unavailable', 'revoked'].includes(value.health)
    ? value.health
    : 'available';
  return {
    nodePeerId,
    nodeAuthorizationDigest: [...value.nodeAuthorizationDigest],
    authorizationEpoch: value.authorizationEpoch,
    routeId,
    routeType: value.routeType,
    transport: value.transport,
    endpointOrigin,
    ...(value.relayPeerId?.trim() ? { relayPeerId: value.relayPeerId.trim() } : {}),
    routeGeneration: value.routeGeneration,
    ...(value.innerTlsSpkiSha256?.length
      ? { innerTlsSpkiSha256: [...value.innerTlsSpkiSha256] }
      : {}),
    addresses,
    ...(value.attestationBytes?.length
      ? { attestationBytes: [...value.attestationBytes] }
      : {}),
    ...(value.attestationExpiresAtUnixMs
      ? { attestationExpiresAtUnixMs: value.attestationExpiresAtUnixMs }
      : {}),
    sourceRef: value.sourceRef?.trim() ?? '',
    lastVerifiedAt: 'lastVerifiedAt' in value && typeof value.lastVerifiedAt === 'number'
      ? value.lastVerifiedAt
      : Date.now(),
    ...('lastSuccessAt' in value && typeof value.lastSuccessAt === 'number'
      ? { lastSuccessAt: value.lastSuccessAt }
      : {}),
    health,
  };
}

function normalizeVerifiedStationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!isRootHttpOrigin(url)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isRootHttpOrigin(url: URL): boolean {
  return (
    (url.protocol === 'https:' || url.protocol === 'http:')
    && Boolean(url.hostname)
    && !url.username
    && !url.password
    && (url.pathname === '' || url.pathname === '/')
    && !url.search
    && !url.hash
  );
}

function normalizeStationAddress(value: string): string | null {
  const raw = value.trim().replace(/\/+$/g, '');
  if (!raw || /\s/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

function extractStationLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.port ? `:${parsed.port}` : '');
  } catch {
    return url;
  }
}

function compareRecentlyUsed(a: MobileStationEntry, b: MobileStationEntry) {
  return b.lastUsedAt - a.lastUsedAt;
}

function applyStationStatus(entry: MobileStationEntry, status: StationStatusInput): MobileStationEntry {
  return {
    ...entry,
    label: status.label?.trim() || entry.label,
    lastCheckedAt: status.checkedAt ?? entry.lastCheckedAt,
    online: status.online ?? entry.online,
  };
}

function isSameStationEntry(a: MobileStationEntry, b: MobileStationEntry): boolean {
  return (
    a.url === b.url &&
    a.stationPeerId === b.stationPeerId &&
    a.label === b.label &&
    a.createdAt === b.createdAt &&
    a.lastUsedAt === b.lastUsedAt &&
    a.lastCheckedAt === b.lastCheckedAt &&
    a.online === b.online &&
    a.identityVerified === b.identityVerified &&
    equalBytes(
      a.pinnedStationRootPublicKey ?? [],
      b.pinnedStationRootPublicKey ?? [],
    ) &&
    JSON.stringify(a.routes ?? []) === JSON.stringify(b.routes ?? []) &&
    a.activeRouteId === b.activeRouteId &&
    a.routeRevision === b.routeRevision &&
    a.lifecycleGeneration === b.lifecycleGeneration
  );
}

function isStationEntry(value: unknown): value is MobileStationEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<MobileStationEntry>;
  return (
    typeof entry.stationPeerId === 'string' &&
    Boolean(entry.stationPeerId.trim()) &&
    typeof entry.url === 'string' &&
    normalizeVerifiedStationUrl(entry.url) !== null &&
    typeof entry.label === 'string' &&
    typeof entry.createdAt === 'number' &&
    typeof entry.lastUsedAt === 'number' &&
    Array.isArray(entry.pinnedStationRootPublicKey) &&
    entry.pinnedStationRootPublicKey.length > 0 &&
    Array.isArray(entry.routes) &&
    entry.routes.length > 0 &&
    entry.routes.every((route) => normalizeRouteCandidate(route) !== null) &&
    typeof entry.activeRouteId === 'string' &&
    entry.routes.some((route) => route.routeId === entry.activeRouteId) &&
    Number.isSafeInteger(entry.routeRevision) &&
    (entry.routeRevision ?? 0) > 0 &&
    Number.isSafeInteger(entry.lifecycleGeneration) &&
    (entry.lifecycleGeneration ?? 0) > 0
  );
}

function equalBytes(left: number[], right: number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isStoredStationRegistry(value: Partial<StoredStationRegistry>): value is StoredStationRegistry {
  return (
    typeof value.activeStationPeerId === 'string' &&
    Array.isArray(value.entries) &&
    value.entries.every(isStationEntry)
  );
}
