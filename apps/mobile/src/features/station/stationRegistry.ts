import { createMobileAppStorageRuntime } from '../../storage/mobileClientStorage';

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
}

export interface StoredStationRegistry {
  activeStationPeerId: string;
  entries: MobileStationEntry[];
}

export interface StationAddressInput {
  protocol: StationProtocol;
  address: string;
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

const STATION_REGISTRY_KEY = 'peers-touch.mobile.station-registry.v1';

export async function loadStationRegistry(): Promise<StoredStationRegistry> {
  const repository = createMobileAppStorageRuntime().repositories.stationRegistry;
  try {
    const parsed = await repository.readValue(STATION_REGISTRY_KEY) as Partial<StoredStationRegistry> | null;
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
  const entries = parsed.entries.slice().sort(compareRecentlyUsed);
  return {
    activeStationPeerId: entries.some((entry) => entry.stationPeerId === parsed.activeStationPeerId)
      ? parsed.activeStationPeerId
      : entries[0]?.stationPeerId ?? '',
    entries,
  };
}

export function addStationEntry(
  registry: StoredStationRegistry,
  input: VerifiedStationInput,
  status: StationStatusInput = {},
  identityVerified: boolean = true,
): { ok: true; registry: StoredStationRegistry } | { ok: false; error: string } {
  const stationPeerId = input.stationPeerId.trim();
  const normalized = normalizeVerifiedStationUrl(input.url);
  if (!stationPeerId || !normalized) return { ok: false, error: 'mobile.launch.stationIdentityInvalid' };
  if (identityVerified) {
    const conflictingUrl = registry.entries.find(
      (entry) => entry.url === normalized && entry.stationPeerId !== stationPeerId,
    );
    if (conflictingUrl) return { ok: false, error: 'mobile.launch.stationIdentityMismatch' };
  }

  const now = Date.now();
  const entries = registry.entries.filter((entry) => entry.stationPeerId !== stationPeerId);
  const existing = registry.entries.find((entry) => entry.stationPeerId === stationPeerId);
  const nextEntry: MobileStationEntry = existing
    ? { ...existing, url: normalized, lastUsedAt: now, identityVerified }
    : {
        stationPeerId,
        url: normalized,
        label: extractStationLabel(normalized),
        createdAt: now,
        lastUsedAt: now,
        identityVerified,
      };
  const checkedEntry = applyStationStatus(nextEntry, status);

  return {
    ok: true,
    registry: {
      activeStationPeerId: stationPeerId,
      entries: [checkedEntry, ...entries].sort(compareRecentlyUsed),
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
  const entries = registry.entries
    .map((entry) => (
      entry.stationPeerId === stationPeerId
        ? applyStationStatus({ ...entry, lastUsedAt: now }, status)
        : entry
    ))
    .sort(compareRecentlyUsed);

  return { activeStationPeerId: stationPeerId, entries };
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

export function activeStationEntry(registry: StoredStationRegistry): MobileStationEntry | null {
  return registry.entries.find((entry) => entry.stationPeerId === registry.activeStationPeerId) ?? null;
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

export function buildStationUrl(input: StationAddressInput): string | null {
  const address = normalizeStationAddress(input.address);
  if (!address) return null;

  try {
    const url = new URL(`${input.protocol}://${address}`);
    if (!url.hostname) return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function splitStationInput(value: string, fallbackProtocol: StationProtocol): StationAddressInput {
  const raw = value.trim();
  const protocolMatch = raw.match(/^(https?):\/\/(.+)$/i);
  if (!protocolMatch) return { protocol: fallbackProtocol, address: raw };

  return {
    protocol: protocolMatch[1].toLowerCase() === 'http' ? 'http' : 'https',
    address: protocolMatch[2],
  };
}

function createEmptyStationRegistry(): StoredStationRegistry {
  return { activeStationPeerId: '', entries: [] };
}

function normalizeVerifiedStationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeStationAddress(value: string): string | null {
  const raw = value.trim().replace(/^\/+|\/+$/g, '');
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return null;
  if (/\s/.test(raw)) return null;
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
    a.online === b.online
  );
}

function isStationEntry(value: unknown): value is MobileStationEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<MobileStationEntry>;
  return (
    typeof entry.stationPeerId === 'string' &&
    Boolean(entry.stationPeerId.trim()) &&
    typeof entry.url === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.createdAt === 'number' &&
    typeof entry.lastUsedAt === 'number'
  );
}

function isStoredStationRegistry(value: Partial<StoredStationRegistry>): value is StoredStationRegistry {
  return (
    typeof value.activeStationPeerId === 'string' &&
    Array.isArray(value.entries) &&
    value.entries.every(isStationEntry)
  );
}
