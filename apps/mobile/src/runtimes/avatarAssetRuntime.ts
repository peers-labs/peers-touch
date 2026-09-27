import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { DomainCacheRepository } from '@peers-touch/client-storage';

import type { MobileAuthSession } from '../features/auth/authSession';
import {
  executeStationOperation,
  responseArrayBuffer,
} from '../services/stationTransport';
import { useAuthStore } from '../features/auth/authStore';
import { createMobileClientStorageRuntime } from '../storage/mobileClientStorage';
import { readableErrorMessage } from '../utils/errorMessage';

export type AvatarAssetStatus = 'empty' | 'cached' | 'loading' | 'ready' | 'failed';

export interface AvatarAssetViewModel {
  source: string;
  src: string | null;
  status: AvatarAssetStatus;
  stale: boolean;
  error: string | null;
}

interface EnsureAvatarInput {
  displayUrl: string;
  session: MobileAuthSession | null;
}

interface AvatarDownloadContext {
  displayUrl: string;
  session: MobileAuthSession;
}

interface AvatarAssetPlatformAdapter {
  download: (context: AvatarDownloadContext, signal: AbortSignal) => Promise<string>;
}

const EMPTY_AVATAR: AvatarAssetViewModel = {
  source: '',
  src: null,
  status: 'empty',
  stale: false,
  error: null,
};

const MAX_PERSISTENT_AVATAR_BYTES = 256 * 1024;
const projections = new Map<string, AvatarAssetViewModel>();
const loadingProjections = new Map<string, AvatarAssetViewModel>();
const listeners = new Set<() => void>();
const inflight = new Map<string, AbortController>();

const mobileAvatarAdapter: AvatarAssetPlatformAdapter = {
  download: async ({ displayUrl, session }, signal) => {
    const url = new URL(displayUrl);
    const key = url.pathname === '/sub-oss/file'
      ? url.searchParams.get('key')?.trim()
      : '';
    const blob = key
      ? await loadStationAvatar(session, key, signal)
      : await loadPublicAvatar(displayUrl, signal);
    return blobToDataUrl(blob);
  },
};

export function useAvatarAsset(source: string | null | undefined): AvatarAssetViewModel {
  const session = useAuthStore((state) => state.session);
  const stationUrl = session?.stationUrl ?? '';
  const displayUrl = useMemo(() => avatarDisplayUrl(source, stationUrl), [source, stationUrl]);

  const snapshot = useSyncExternalStore(
    subscribeAvatarProjection,
    () => selectAvatarProjection(displayUrl),
    () => selectAvatarProjection(displayUrl),
  );

  useEffect(() => {
    void ensureAvatarAsset({ displayUrl, session });
  }, [displayUrl, session]);

  return snapshot;
}

export function avatarDisplayUrl(value: string | null | undefined, stationUrl: string | undefined): string {
  const raw = value?.trim() ?? '';
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  if (raw.startsWith('/')) {
    return stationUrl ? new URL(raw, `${stationUrl.replace(/\/+$/, '')}/`).toString() : '';
  }
  return '';
}

function subscribeAvatarProjection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function selectAvatarProjection(displayUrl: string): AvatarAssetViewModel {
  if (!displayUrl) return EMPTY_AVATAR;
  return projections.get(displayUrl) ?? loadingAvatarProjection(displayUrl);
}

function loadingAvatarProjection(displayUrl: string): AvatarAssetViewModel {
  const existing = loadingProjections.get(displayUrl);
  if (existing) return existing;

  const next: AvatarAssetViewModel = {
    source: displayUrl,
    src: null,
    status: 'loading',
    stale: false,
    error: null,
  };
  loadingProjections.set(displayUrl, next);
  return next;
}

async function ensureAvatarAsset({ displayUrl, session }: EnsureAvatarInput): Promise<void> {
  if (!displayUrl) return;

  const stationAsset = session ? isStationUrl(displayUrl, session.stationUrl) : false;
  if (!stationAsset) {
    setAvatarProjection(displayUrl, {
      source: displayUrl,
      src: displayUrl,
      status: 'ready',
      stale: false,
      error: null,
    });
    return;
  }

  if (!session) {
    setAvatarProjection(displayUrl, failedProjection(displayUrl, 'mobile.avatar.missingSession'));
    return;
  }

  const current = projections.get(displayUrl);
  if (current?.status === 'ready' && !current.stale) return;
  if (inflight.has(displayUrl)) return;

  const avatarRepository = createMobileClientStorageRuntime(session).repositories.avatars;
  const cached = await readCachedAvatar(avatarRepository, displayUrl);
  if (cached?.src) {
    setAvatarProjection(displayUrl, {
      source: displayUrl,
      src: cached.src,
      status: cached.stale ? 'cached' : 'ready',
      stale: cached.stale,
      error: null,
    });
    if (!cached.stale) return;
  } else {
    setAvatarProjection(displayUrl, {
      source: displayUrl,
      src: null,
      status: 'loading',
      stale: false,
      error: null,
    });
  }

  const controller = new AbortController();
  inflight.set(displayUrl, controller);
  try {
    const dataUrl = await mobileAvatarAdapter.download({ displayUrl, session }, controller.signal);
    await writeCachedAvatar(avatarRepository, displayUrl, dataUrl);
    setAvatarProjection(displayUrl, {
      source: displayUrl,
      src: dataUrl,
      status: 'ready',
      stale: false,
      error: null,
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') return;
    const previous = projections.get(displayUrl);
    setAvatarProjection(
      displayUrl,
      previous?.src
        ? { ...previous, status: 'cached', stale: true, error: errorMessage(error) }
        : failedProjection(displayUrl, errorMessage(error)),
    );
  } finally {
    inflight.delete(displayUrl);
  }
}

async function loadStationAvatar(
  session: MobileAuthSession,
  key: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await executeStationOperation(
    session,
    { operationId: 'oss_download', key },
    signal,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`mobile.avatar.fetchFailed.${response.status}`);
  }
  return new Blob([responseArrayBuffer(response)], {
    type: response.contentType || 'application/octet-stream',
  });
}

async function loadPublicAvatar(
  displayUrl: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch(displayUrl, {
    cache: 'force-cache',
    signal,
  });
  if (!response.ok) throw new Error(`mobile.avatar.fetchFailed.${response.status}`);
  return response.blob();
}

async function readCachedAvatar(
  repository: DomainCacheRepository<string>,
  displayUrl: string,
): Promise<{ src: string; stale: boolean } | null> {
  try {
    const cached = await repository.read(displayUrl);
    if (!cached.envelope?.value) return null;
    return { src: cached.envelope.value, stale: cached.stale };
  } catch {
    return null;
  }
}

async function writeCachedAvatar(repository: DomainCacheRepository<string>, displayUrl: string, dataUrl: string): Promise<void> {
  if (dataUrl.length > MAX_PERSISTENT_AVATAR_BYTES * 2) return;
  await repository.write(displayUrl, dataUrl).catch(() => undefined);
}

function setAvatarProjection(displayUrl: string, next: AvatarAssetViewModel): void {
  const previous = projections.get(displayUrl);
  if (sameAvatarProjection(previous, next)) return;
  loadingProjections.delete(displayUrl);
  projections.set(displayUrl, next);
  listeners.forEach((listener) => listener());
}

function sameAvatarProjection(left: AvatarAssetViewModel | undefined, right: AvatarAssetViewModel): boolean {
  return Boolean(
    left &&
      left.source === right.source &&
      left.src === right.src &&
      left.status === right.status &&
      left.stale === right.stale &&
      left.error === right.error,
  );
}

function failedProjection(displayUrl: string, error: string): AvatarAssetViewModel {
  return {
    source: displayUrl,
    src: null,
    status: 'failed',
    stale: false,
    error,
  };
}

function isStationUrl(value: string, stationUrl: string): boolean {
  if (!stationUrl) return false;
  try {
    return new URL(value).origin === new URL(stationUrl).origin;
  } catch {
    return false;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('mobile.avatar.blobReadFailed'));
    reader.readAsDataURL(blob);
  });
}

function errorMessage(error: unknown): string {
  return readableErrorMessage(error);
}
