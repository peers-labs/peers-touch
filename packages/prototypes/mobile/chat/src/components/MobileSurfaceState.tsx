import { useT } from '../i18n';
import { Icon } from '@peers-touch/ui';
import type { ReactNode } from 'react';

export function ConversationListSkeleton() {
  const t = useT();
  return (
    <div className="mp-conversation-skeleton" role="status" aria-label={t('mobile.ui.loadingConversations')}>
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="mp-conversation-skeleton-row">
          <span className="mp-skeleton-block mp-skeleton-avatar" />
          <span className="mp-conversation-skeleton-copy">
            <span className="mp-skeleton-block mp-skeleton-title" />
            <span className="mp-skeleton-block mp-skeleton-line" />
          </span>
          <span className="mp-skeleton-block mp-skeleton-time" />
        </div>
      ))}
    </div>
  );
}

export function ThreadSkeleton() {
  const t = useT();
  return (
    <div className="mp-thread-skeleton" role="status" aria-label={t('mobile.ui.loadingMessages')}>
      {['peer short', 'peer long', 'mine medium', 'peer medium', 'mine short'].map((shape) => (
        <div key={shape} className={`mp-thread-skeleton-row ${shape}`}>
          {shape.startsWith('peer') && <span className="mp-skeleton-block mp-skeleton-avatar" />}
          <span className="mp-skeleton-block mp-skeleton-bubble" />
        </div>
      ))}
    </div>
  );
}

export function InlineSurfaceNotice({
  tone = 'quiet',
  title,
  detail,
  actionLabel,
  onAction,
}: {
  tone?: 'quiet' | 'error';
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`mp-inline-surface-notice ${tone}`} role="status" aria-live="polite">
      <Icon iconId={tone === 'error' ? 'error' : 'refresh-ccw'} size={15} />
      <span className="mp-inline-surface-copy">
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>{actionLabel}</button>
      )}
    </div>
  );
}

export function RouteSurfaceState({
  icon,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  icon?: ReactNode;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mp-route-surface-state" role="status">
      <span className="mp-route-surface-icon" aria-hidden="true">
        {icon ?? <Icon iconId="message-circle" size={22} />}
      </span>
      <strong>{title}</strong>
      <span>{detail}</span>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction}>
          <Icon iconId="refresh-ccw" size={16} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}
