import { useTranslation } from 'react-i18next';

import { SquareAvatar } from '../../common/SquareAvatar';

/**
 * TypingIndicator — receiver-side "peer is composing" row.
 *
 * North-star parity (prototype .sk-typing-row / .sk-typing-bubble): a small
 * avatar beside a peer-surface bubble holding three staggered bouncing dots.
 * Purely presentational; the typing presence is owned by the social chat
 * store (typingPeers) and swept when pulses go stale. Fully token-driven so it
 * tracks light/dark themes without hardcoded colors.
 */
interface TypingIndicatorProps {
  kind: 'friend' | 'group';
  avatarUrl?: string;
  name: string;
}

export function TypingIndicator({ kind, avatarUrl, name }: TypingIndicatorProps) {
  const { t } = useTranslation('chat');
  return (
    <div
      className="sc-typing-row"
      data-chat-typing-indicator="active"
      data-conversation-kind={kind}
      aria-label={t('chat.social.messageArea.typing')}
    >
      <SquareAvatar remoteUrl={avatarUrl} name={name} size={32} />
      <span className="sc-typing-bubble" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
