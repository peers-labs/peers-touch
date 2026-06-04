export type StationProtocol = 'https' | 'http';

export interface MobileStationEntry {
  url: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  lastCheckedAt?: number;
  online?: boolean;
}

export interface StoredStationRegistry {
  activeUrl: string;
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

const STATION_REGISTRY_KEY = 'peers-touch.mobile.station-registry.v1';

export async function loadStationRegistry(): Promise<StoredStationRegistry> {
  try {
    const parsed = await createMobileAppStorageRuntime().repositories.stationRegistry.readValue(STATION_REGISTRY_KEY) as Partial<StoredStationRegistry> | null;
    if (!parsed) return createEmptyStationRegistry();
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(isStationEntry).sort(compareRecentlyUsed)
      : [];
    const activeUrl = typeof parsed.activeUrl === 'string' ? parsed.activeUrl : '';

    return {
      activeUrl: entries.some((entry) => entry.url === activeUrl) ? activeUrl : entries[0]?.url ?? '',
      entries,
    };
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

export function addStationEntry(
  registry: StoredStationRegistry,
  input: StationAddressInput,
  status: StationStatusInput = {},
): { ok: true; registry: StoredStationRegistry } | { ok: false; error: string } {
  const normalized = buildStationUrl(input);
  if (!normalized) return { ok: false, error: 'mobile.launch.validAddressHint' };

  const now = Date.now();
  const entries = registry.entries.filter((entry) => entry.url !== normalized);
  const existing = registry.entries.find((entry) => entry.url === normalized);
  const nextEntry: MobileStationEntry = existing
    ? { ...existing, lastUsedAt: now }
    : {
        url: normalized,
        label: extractStationLabel(normalized),
        createdAt: now,
        lastUsedAt: now,
      };
  const checkedEntry = applyStationStatus(nextEntry, status);

  return {
    ok: true,
    registry: {
      activeUrl: normalized,
      entries: [checkedEntry, ...entries].sort(compareRecentlyUsed),
    },
  };
}

export function activateStationEntry(
  registry: StoredStationRegistry,
  url: string,
  status: StationStatusInput = {},
): StoredStationRegistry {
  const now = Date.now();
  const entries = registry.entries
    .map((entry) => (entry.url === url ? applyStationStatus({ ...entry, lastUsedAt: now }, status) : entry))
    .sort(compareRecentlyUsed);

  return { activeUrl: url, entries };
}

export function updateStationEntryStatus(
  registry: StoredStationRegistry,
  url: string,
  status: StationStatusInput,
): StoredStationRegistry {
  return {
    ...registry,
    entries: registry.entries.map((entry) => (entry.url === url ? applyStationStatus(entry, status) : entry)),
  };
}

export function removeStationEntry(registry: StoredStationRegistry, url: string): StoredStationRegistry {
  const entries = registry.entries.filter((entry) => entry.url !== url);
  const activeUrl = registry.activeUrl === url ? entries[0]?.url ?? '' : registry.activeUrl;
  return { activeUrl, entries };
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
  return { activeUrl: '', entries: [] };
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

function isStationEntry(value: unknown): value is MobileStationEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<MobileStationEntry>;
  return (
    typeof entry.url === 'string' &&
    typeof entry.label === 'string' &&
    typeof entry.createdAt === 'number' &&
    typeof entry.lastUsedAt === 'number'
  );
}
import { createMobileAppStorageRuntime } from '../../storage/mobileClientStorage';
