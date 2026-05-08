// Unified avatar surface for the desktop app.
//
// Project rule (do NOT weaken this contract):
//   1. Always render the locally cached image when available.
//   2. On cache miss, ask the Rust backend to download from Station.
//   3. While that resolve is in flight, use the remote image URL as a
//      visual bridge so contacts do not flash to the fallback avatar.
//   4. If local and remote image loading both fail, render the unified
//      fallback (initial / Bot icon).
//
// Two render paths exist depending on host:
//   * Native Tauri webview → `convertFileSrc(localPath)` produces an
//     `asset://` URL the webview can load.
//   * Browser dev gateway (`make dev-dual` web window, plain Chrome) →
//     `convertFileSrc` is a no-op polyfill (see `main.tsx`); a local file
//     path cannot be loaded by the browser. We therefore route the image
//     through the local HTTP gateway: `GET /avatar?url=<encoded>`. The
//     gateway shares the SAME on-disk cache as the Tauri side, so this
//     does not duplicate downloads.
//
// Callers MUST pass a remote URL only. The component is the single owner of the
// "where do I read the bytes from" decision, so the rule cannot be bypassed
// from the call site.

import { convertFileSrc } from '@tauri-apps/api/core';
import { Bot } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';

declare global {
  interface Window {
    __PT_GATEWAY_BASE__?: string;
  }
}

// True when the app runs outside the Tauri webview (the dev gateway shim
// in `main.tsx` set this flag on `window`). We resolve it once at module
// load — the host does not change at runtime.
const IS_BROWSER_GATEWAY = typeof window !== 'undefined'
  && typeof window.__PT_GATEWAY_BASE__ === 'string'
  && window.__PT_GATEWAY_BASE__.length > 0;

function gatewayAvatarUrl(remoteUrl: string): string {
  const base = window.__PT_GATEWAY_BASE__ as string;
  return `${base}/avatar?url=${encodeURIComponent(remoteUrl)}`;
}

interface UserSquareAvatarProps {
  /** Remote avatar URL (Station OSS or OAuth provider). The component will
   *  resolve this to a locally cached file before rendering. */
  remoteUrl?: string;
  name?: string;
  size?: number;
  radius?: number;
  fallback?: ReactNode;
  background?: string;
  border?: string;
  style?: CSSProperties;
}

// Process-wide cache so the same URL is resolved exactly once across all
// avatar instances (chat list, popovers, message bubbles, ...).
type CacheEntry = string | null;
type ResolvedAvatar = { remoteUrl: string; path: CacheEntry };
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

function nameInitial(name?: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 1).toUpperCase();
}

export function UserSquareAvatar({
  remoteUrl,
  name = 'User',
  size = 36,
  radius,
  fallback,
  background,
  border,
  style,
}: UserSquareAvatarProps) {
  const rounded = radius ?? Math.max(8, Math.floor(size * 0.25));
  const [resolvedAvatar, setResolvedAvatar] = useState<ResolvedAvatar | null>(() =>
    remoteUrl && resolveCache.has(remoteUrl)
      ? { remoteUrl, path: resolveCache.get(remoteUrl) ?? null }
      : null,
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const requestedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!remoteUrl) return;
    // Browser path: skip the Rust resolve round-trip entirely. The gateway
    // route (`GET /avatar?url=…`) handles cache lookup + Station download
    // server-side; a single fetch beats the two-step "resolve, then load
    // file" pattern that the native path uses for historical reasons.
    if (IS_BROWSER_GATEWAY) return;
    let cancelled = false;
    const applyResolvedPath = (path: CacheEntry) => {
      if (cancelled || requestedFor.current !== remoteUrl) return;
      setResolvedAvatar({ remoteUrl, path });
    };
    const cached = resolveCache.get(remoteUrl);
    if (cached !== undefined) {
      requestedFor.current = remoteUrl;
      window.queueMicrotask(() => applyResolvedPath(cached));
      return () => {
        cancelled = true;
      };
    }
    requestedFor.current = remoteUrl;
    resolveLocalPath(remoteUrl).then((path) => {
      applyResolvedPath(path);
    });
    return () => {
      cancelled = true;
    };
  }, [remoteUrl]);

  const localPath = resolvedAvatar && resolvedAvatar.remoteUrl === remoteUrl ? resolvedAvatar.path : null;

  const imageSrc = (() => {
    if (!remoteUrl) return null;
    if (IS_BROWSER_GATEWAY) return gatewayAvatarUrl(remoteUrl);
    if (localPath) return convertFileSrc(localPath);
    return remoteUrl;
  })();
  const showImage = !!imageSrc && failedSrc !== imageSrc;

  if (showImage) {
    return (
      <img
        src={imageSrc as string}
        alt={name}
        onError={() => {
          // Drop the cache entry so the next mount triggers a re-download.
          if (remoteUrl && localPath && !IS_BROWSER_GATEWAY) resolveCache.delete(remoteUrl);
          setFailedSrc(imageSrc);
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

  const initial = nameInitial(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        background: background || 'linear-gradient(135deg, #667eea, #764ba2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        border,
        color: '#fff',
        fontSize: Math.floor(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
        ...style,
      }}
    >
      {fallback || (initial ? initial : <Bot size={Math.floor(size * 0.5)} color="#fff" />)}
    </div>
  );
}
