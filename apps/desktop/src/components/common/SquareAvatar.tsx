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
  const [localPath, setLocalPath] = useState<string | null>(() =>
    remoteUrl ? resolveCache.get(remoteUrl) ?? null : null,
  );
  const [imgError, setImgError] = useState(false);
  const requestedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    setImgError(false);
    if (!remoteUrl) {
      setLocalPath(null);
      return;
    }
    if (isBrowserGateway()) {
      setLocalPath(remoteUrl);
      return;
    }
    const cached = resolveCache.get(remoteUrl);
    if (cached !== undefined) {
      setLocalPath(cached);
      return;
    }
    let cancelled = false;
    requestedFor.current = remoteUrl;
    resolveLocalPath(remoteUrl).then((path) => {
      if (cancelled || requestedFor.current !== remoteUrl) return;
      setLocalPath(path);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteUrl]);

  const showImage = !!localPath && !imgError;

  if (showImage) {
    const src = isBrowserGateway()
      ? gatewayAvatarUrl(remoteUrl as string)
      : convertFileSrc(localPath as string);
    return (
      <img
        src={src}
        alt={name}
        onLoad={(event) => {
          // #region debug-point B,D:resolved-avatar-load
          fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'avatar-details-load', runId: 'post-fix', hypothesisId: 'B,D', location: 'SquareAvatar:onLoad', msg: '[DEBUG] Resolved avatar loaded', data: { name, source: remoteUrl, currentSrc: event.currentTarget.currentSrc, naturalWidth: event.currentTarget.naturalWidth }, ts: Date.now() }) }).catch(() => {});
          // #endregion
        }}
        onError={(event) => {
          // #region debug-point B,D:resolved-avatar-error
          fetch('http://127.0.0.1:7778/event', { method: 'POST', body: JSON.stringify({ sessionId: 'avatar-details-load', runId: 'post-fix', hypothesisId: 'B,D', location: 'SquareAvatar:onError', msg: '[DEBUG] Resolved avatar failed', data: { name, source: remoteUrl, currentSrc: event.currentTarget.currentSrc, complete: event.currentTarget.complete, naturalWidth: event.currentTarget.naturalWidth }, ts: Date.now() }) }).catch(() => {});
          // #endregion
          if (remoteUrl && !isBrowserGateway()) resolveCache.delete(remoteUrl);
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
