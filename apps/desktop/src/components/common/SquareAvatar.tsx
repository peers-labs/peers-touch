import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';

function isBrowserGateway(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as any).__PT_GATEWAY_BASE__ === 'string'
    && (window as any).__PT_GATEWAY_BASE__.length > 0;
}

function gatewayAvatarUrl(remoteUrl: string): string {
  const base = (window as any).__PT_GATEWAY_BASE__ as string;
  return `${base}/avatar?url=${encodeURIComponent(remoteUrl)}`;
}

type CacheEntry = string | null;
const resolveCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
const RETIRED_GENERATED_AVATAR_PREFIX = 'https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?';

export function inlineAvatarSource(remoteUrl?: string): string | null {
  const value = remoteUrl?.trim() ?? '';
  return value.startsWith('data:image/') ? value : null;
}

export function downloadableAvatarSource(remoteUrl?: string): string | null {
  const value = remoteUrl?.trim() ?? '';
  if (!value || inlineAvatarSource(value) || value.startsWith(RETIRED_GENERATED_AVATAR_PREFIX)) {
    return null;
  }
  return value;
}

async function resolveLocalPath(remoteUrl: string): Promise<CacheEntry> {
  if (resolveCache.has(remoteUrl)) {
    return resolveCache.get(remoteUrl) ?? null;
  }
  const existing = inflight.get(remoteUrl);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const data = await api.avatarResolveLocal(remoteUrl);
      const path = data?.local_path ?? null;
      resolveCache.set(remoteUrl, path);
      return path;
    } catch (error) {
      log.warn('avatar', 'Failed to resolve local avatar', { error, remoteUrl });
      resolveCache.set(remoteUrl, null);
      return null;
    } finally {
      inflight.delete(remoteUrl);
    }
  })();

  inflight.set(remoteUrl, promise);
  return promise;
}

export interface SquareAvatarProps {
  remoteUrl?: string;
  name?: string;
  size?: number;
  radius?: number;
  border?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function SquareAvatar({
  remoteUrl,
  name = '',
  size = 36,
  radius,
  border,
  style,
  children,
}: SquareAvatarProps) {
  const rounded = radius ?? Math.max(8, Math.floor(size * 0.25));
  const inlineSource = inlineAvatarSource(remoteUrl);
  const downloadableSource = downloadableAvatarSource(remoteUrl);
  const [localPath, setLocalPath] = useState<string | null>(() =>
    downloadableSource ? resolveCache.get(downloadableSource) ?? null : null,
  );
  const [imgError, setImgError] = useState(false);
  const requestedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    setImgError(false);
    if (!downloadableSource) {
      setLocalPath(null);
      return;
    }
    if (isBrowserGateway()) {
      setLocalPath(downloadableSource);
      return;
    }
    const cached = resolveCache.get(downloadableSource);
    if (cached !== undefined) {
      setLocalPath(cached);
      return;
    }
    let cancelled = false;
    requestedFor.current = downloadableSource;
    resolveLocalPath(downloadableSource).then((path) => {
      if (cancelled || requestedFor.current !== downloadableSource) return;
      setLocalPath(path);
    });
    return () => {
      cancelled = true;
    };
  }, [downloadableSource, inlineSource]);

  const showImage = !!(inlineSource || localPath) && !imgError;

  if (showImage) {
    const src = inlineSource
      ?? (isBrowserGateway()
        ? gatewayAvatarUrl(downloadableSource as string)
        : convertFileSrc(localPath as string));
    return (
      <img
        src={src}
        alt={name}
        onError={() => {
          if (downloadableSource && !isBrowserGateway()) resolveCache.delete(downloadableSource);
          setImgError(true);
        }}
        style={{
          width: size,
          height: size,
          borderRadius: rounded,
          objectFit: 'cover',
          flexShrink: 0,
          border,
          ...style,
        }}
      />
    );
  }

  return <>{children}</>;
}
