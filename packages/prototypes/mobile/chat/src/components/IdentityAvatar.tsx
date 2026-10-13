import { useEffect, useMemo, useState } from 'react';
import type { AvatarRenderState } from '../types';

function toneForIdentity(identity: string): number {
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = (hash * 31 + identity.charCodeAt(index)) >>> 0;
  }
  return hash % 4;
}

export function IdentityAvatar({
  name,
  initials,
  src,
  kind = 'person',
  size = 44,
  online = false,
  showPresence = false,
  renderState = 'ready',
  className = '',
}: {
  name: string;
  initials: string;
  src?: string;
  kind?: 'person' | 'group';
  size?: number;
  online?: boolean;
  showPresence?: boolean;
  renderState?: AvatarRenderState;
  className?: string;
}) {
  const [assetState, setAssetState] = useState<AvatarRenderState>(src ? 'loading' : 'failed');
  const tone = useMemo(() => toneForIdentity(name), [name]);

  useEffect(() => {
    setAssetState(src ? 'loading' : 'failed');
  }, [src]);

  const visibleState = renderState === 'ready' ? assetState : renderState;
  const canRenderImage = Boolean(src) && renderState !== 'failed';

  // Rounded-square is the only avatar geometry; radius is size-derived and
  // never circular. Groups inherit the lg token from CSS; people use the
  // tighter size-derived corner, matching the shared SquareAvatar contract.
  const personRadius = kind === 'person' ? Math.max(8, Math.round(size / 4)) : undefined;

  return (
    <span
      className={`mp-identity-avatar ${kind} tone-${tone} ${className}`.trim()}
      style={{ width: size, height: size, ...(personRadius === undefined ? {} : { borderRadius: personRadius }) }}
      role="img"
      aria-label={name}
      data-avatar-state={visibleState}
    >
      <span className="mp-identity-fallback" aria-hidden="true">{initials}</span>
      {canRenderImage && (
        <img
          className="mp-identity-image"
          src={src}
          alt=""
          onLoad={() => setAssetState('ready')}
          onError={() => setAssetState('failed')}
        />
      )}
      {renderState === 'loading' && <span className="mp-identity-loading" aria-hidden="true" />}
      {showPresence && online && visibleState !== 'loading' && (
        <span className="mp-online-dot" aria-label="Online" />
      )}
    </span>
  );
}
