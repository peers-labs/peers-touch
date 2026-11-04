import { useEffect, useState } from 'react';
import { Icon } from '@peers-touch/ui';
import { useT } from '../i18n';
import type { AvatarRenderState } from '../types';

/**
 * Squared-square identity avatar on the pine grammar.
 * Fallback is an initials tile on --pt-primarySubtle; groups carry the
 * registered users glyph. Presence dot is the only colored element.
 */
export function IdentityAvatar({
  name,
  initials,
  src,
  kind = 'person',
  size = 40,
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
  const t = useT();
  const [assetState, setAssetState] = useState<AvatarRenderState>(src ? 'loading' : 'failed');

  useEffect(() => {
    setAssetState(src ? 'loading' : 'failed');
  }, [src]);

  const visibleState = renderState === 'ready' ? assetState : renderState;
  const canRenderImage = Boolean(src) && renderState !== 'failed';

  return (
    <span
      className={`mp-identity-avatar ${kind} ${className}`.trim()}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name}
      data-avatar-state={visibleState}
    >
      <span className="mp-identity-fallback" aria-hidden="true">
        {kind === 'group'
          ? <Icon iconId="users" size={Math.round(size * 0.56)} />
          : initials}
      </span>
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
        <span className="mp-online-dot" aria-label={t('mobile.ui.online')} />
      )}
    </span>
  );
}
