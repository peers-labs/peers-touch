// Sender-only optimistic messages.
//
// Renders outbound messages immediately from on-device blob URLs while staging
// and the engine send run in the background. There is deliberately no black
// placeholder: the local image is shown at full opacity with a light scrim and
// a spinner while in flight, and the scrim is removed (not the image swapped)
// once the send admits. Each row keeps a stable local key so status changes
// never remount the <img> or reflow the bubble.
//
// A failed row with reusable payloads exposes the same retry control as a
// normal failed message. Retry flips the row back to the in-flight state in
// place — the failure icon disappears immediately and only returns if the
// re-send genuinely fails again. Rows whose staging never completed have no
// durable payload and stay a static failure instead of faking a retry.

import { AlertCircle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '@peers-touch/ui';

import {
  canRetryOptimistic,
  type OptimisticOutboundMessage,
} from '../../../messaging/optimisticOutbound';

interface Props {
  messages: OptimisticOutboundMessage[];
  onRetry: (message: OptimisticOutboundMessage) => void;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function OptimisticRow({
  message,
  onRetry,
}: {
  message: OptimisticOutboundMessage;
  onRetry: (message: OptimisticOutboundMessage) => void;
}) {
  const { t } = useTranslation('chat');
  const inFlight = message.status === 'staging' || message.status === 'sending';
  const failed = message.status === 'failed';
  const retryable = canRetryOptimistic(message);
  const retryLabel = t('chat.message.action.retry');

  return (
    <div
      className="msg-row is-own sc-optimistic-row"
      data-optimistic-status={message.status}
      data-optimistic-id={message.localId}
    >
      <div className="msg-bubble sc-optimistic-bubble">
        {message.attachments.length > 0 && (
          <div className="sc-msg-attachments sc-msg-attachments--media-only">
            {message.attachments.map((attachment) => (
              <div
                key={attachment.localId}
                className="sc-attachment sc-attachment--image sc-optimistic-attachment"
              >
                <div className="sc-attachment__image sc-optimistic-image">
                  {attachment.previewUrl && attachment.isImage ? (
                    <img src={attachment.previewUrl} alt={attachment.filename} />
                  ) : (
                    <span className="sc-attachment__image-fallback is-own">
                      <AlertCircle size={22} />
                    </span>
                  )}
                  {inFlight && (
                    <span
                      className="sc-optimistic-overlay"
                      role="status"
                      aria-label={t('chat.social.composer.uploading')}
                    >
                      <Loader2 size={20} className="chat-composer-spin" />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {message.text && (
          <span className="sc-optimistic-text" data-message-text={message.localId}>
            {message.text}
          </span>
        )}
        <span className="sc-optimistic-meta">
          {failed && retryable ? (
            <IconButton
              actionId={`optimistic-retry-${message.localId}`}
              data-optimistic-retry={message.localId}
              iconId="rotate-ccw"
              iconSize={12}
              label={retryLabel}
              title={retryLabel}
              emphasis="quiet"
              density="compact"
              aria-live="polite"
              onActivate={() => onRetry(message)}
            />
          ) : failed ? (
            <span className="sc-optimistic-failed" role="alert">
              <AlertCircle size={12} />
              {t('chat.social.messageArea.attachmentStateFailed')}
            </span>
          ) : inFlight && message.attachments.length === 0 ? (
            // Attachment rows already show the scrim spinner over the image;
            // a text-only row needs its own in-flight indicator.
            <span className="sc-optimistic-retrying" role="status">
              <Loader2 size={12} className="chat-composer-spin" />
              {t('chat.social.messageArea.stateRetrying')}
            </span>
          ) : (
            <span className="sc-optimistic-time">{formatClock(message.createdAtMs)}</span>
          )}
        </span>
      </div>
    </div>
  );
}

export function OptimisticOutboundStack({ messages, onRetry }: Props) {
  if (messages.length === 0) return null;
  return (
    <div className="sc-optimistic-stack" data-optimistic-count={messages.length}>
      {messages.map((message) => (
        <OptimisticRow key={message.localId} message={message} onRetry={onRetry} />
      ))}
    </div>
  );
}
