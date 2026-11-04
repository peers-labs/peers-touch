import type { CSSProperties, ReactNode } from 'react';
import { useAvatarAsset } from './useAvatarAsset';
import {
  avatarAssets,
  downloadableAvatarSource,
  inlineAvatarSource,
} from '../../services/avatarAssets';

// Pure classifiers remain exported for existing tests/callers; the cache,
// in-flight de-duplication and decode readiness moved to the React-free
// AvatarAssets owner (services/avatarAssets.ts, r3.1 Identity/Avatar).
export { downloadableAvatarSource, inlineAvatarSource };

export interface SquareAvatarProps {
  /** Canonical avatar identity (remote URL, Station path or data: URI). */
  remoteUrl?: string;
  name?: string;
  size?: number;
  radius?: number;
  border?: string;
  style?: CSSProperties;
  /** Definitive fallback for an authoritative ABSENT avatar (usually initials). */
  children?: ReactNode;
  /** Identity-neutral placeholder while the canonical asset is not ready. */
  neutralFallback?: ReactNode;
  /** Native materialized path hint (account registry rows). */
  avatarLocalPath?: string | null;
  /** Canonical profile revision driving same-URL content swaps. */
  profileRevision?: number | string | null;
  /** Explicit owner PTID (peer avatars). Self avatars bind via the session. */
  actorPtid?: string | null;
  /**
   * Stable non-actor owner key (e.g. a group conversation) so the avatar
   * keeps painting its locally resolved image across reloads, transient
   * fetch failures and restarts instead of swapping to the fallback.
   */
  assetOwnerKey?: string | null;
  /** Localized accessibility title for the degraded (last-good) state. */
  degradedLabel?: string;
}

export function SquareAvatar({
  remoteUrl,
  name = '',
  size = 36,
  radius,
  border,
  style,
  children,
  neutralFallback = null,
  avatarLocalPath,
  profileRevision,
  actorPtid,
  assetOwnerKey,
  degradedLabel,
}: SquareAvatarProps) {
  const rounded = radius ?? Math.max(8, Math.floor(size * 0.25));
  const identity = remoteUrl?.trim() ?? '';
  const inlineSource = inlineAvatarSource(identity);
  const downloadableSource = downloadableAvatarSource(identity);
  const { snapshot: asset } = useAvatarAsset({
    identity: inlineSource ?? downloadableSource ?? '',
    actorPtid,
    assetOwnerKey,
    profileRevision,
    localPath: avatarLocalPath,
  });

  // Paint-ready when we hold either an inline data URI, a freshly decoded
  // image, or the same-actor last-good while a newer identity is degraded.
  const src = inlineSource ?? asset?.src ?? null;
  const paintReady = Boolean(src) && (
    inlineSource !== null
    || asset?.phase === 'ready'
    || asset?.degraded === true
  );
  const degraded = !inlineSource && asset?.degraded === true;

  if (paintReady && src) {
    return (
      <img
        src={src}
        alt={name}
        title={degraded ? degradedLabel : undefined}
        data-pt-avatar-state={degraded ? 'degraded' : 'ready'}
        data-pt-avatar-degraded={degraded ? true : undefined}
        onError={() => {
          if (!inlineSource && src) {
            // Surface the failure to the shared owner so a later mount retries
            // on/after the bounded backoff; never a permanent negative cache.
            avatarAssets.invalidateSrc(src);
          }
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

  // Authoritative ABSENT: caller's deterministic fallback (initials). Anything
  // still resolving or failed without last-good uses the neutral placeholder
  // so an unresolved actor can never paint another actor's letter/image.
  const authoritativeAbsent = asset?.phase === 'absent';
  return <>{authoritativeAbsent ? children : (neutralFallback ?? children)}</>;
}
