import { useTranslation } from 'react-i18next';
import { Empty as PtEmpty } from '@peers-touch/ui';
import { Search } from 'lucide-react';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import type { DesktopIMConversationProjection } from '../../store/socialProjection';
import { chatActorIdentityMetadata } from '../../store/friendshipProjection';

interface ChatSearchDropdownProps {
  searchText: string;
  results: DesktopIMConversationProjection[];
  onSelect: (conversation: DesktopIMConversationProjection) => void;
  onDismiss?: () => void;
}

export function ChatSearchDropdown({ searchText, results, onSelect, onDismiss }: ChatSearchDropdownProps) {
  const { t } = useTranslation('chat');

  const contacts = results.filter((c) => c.kind === 'friend');
  const groups = results.filter((c) => c.kind === 'group');

  if (!searchText.trim()) return null;

  return (
    <>
      {onDismiss && (
        <div
          className="sc-search-dropdown__scrim"
          aria-hidden="true"
          onClick={onDismiss}
        />
      )}
      <div className="sc-search-dropdown">
        {results.length === 0 ? (
          <PtEmpty
            className="sc-search-dropdown__empty"
            icon={<Search size={24} />}
            description={
              <span className="sc-search-dropdown__empty-label">
                {t('chat.social.sessionList.noResults')}
              </span>
            }
          />
        ) : (
          <>
            {contacts.length > 0 && (
              <Section label={t('chat.social.contacts.friends')}>
                {contacts.map((c) => (
                  <ResultRow key={c.id} conversation={c} onSelect={onSelect} />
                ))}
              </Section>
            )}
            {groups.length > 0 && (
              <Section label={t('chat.social.sessionList.groups')}>
                {groups.map((c) => (
                  <ResultRow key={c.id} conversation={c} onSelect={onSelect} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sc-search-dropdown__section">
      <div className="sc-search-dropdown__section-label">{label}</div>
      {children}
    </div>
  );
}

function ResultRow({
  conversation,
  onSelect,
}: {
  conversation: DesktopIMConversationProjection;
  onSelect: (c: DesktopIMConversationProjection) => void;
}) {
  const { t } = useTranslation('chat');
  const name = conversation.title || t('chat.social.sessionList.unknown');
  const identityMetadata = conversation.kind === 'friend' && conversation.peerPtid
    ? chatActorIdentityMetadata({
        actorPtid: conversation.peerPtid,
        federatedHandle: conversation.federatedHandle || '',
        homeStationDomain: conversation.homeStationDomain || '',
        homeStationPeerId: conversation.homeStationPeerId || '',
        federationId: conversation.federationId || '',
        federationName: conversation.federationName || '',
      })
    : '';
  return (
    <button
      type="button"
      className="sc-search-dropdown__row"
      aria-label={name}
      data-chat-search-result
      data-chat-search-result-id={conversation.id}
      data-chat-search-result-kind={conversation.kind}
      data-chat-search-result-peer-ptid={conversation.peerPtid || ''}
      data-chat-identity-federated-handle={conversation.federatedHandle || ''}
      data-chat-identity-home-station-domain={conversation.homeStationDomain || ''}
      data-chat-identity-home-station-peer-id={conversation.homeStationPeerId || ''}
      data-chat-identity-federation-id={conversation.federationId || ''}
      onClick={() => onSelect(conversation)}
    >
      <UserSquareAvatar remoteUrl={conversation.avatar} name={name} size={30} />
      <span className="sc-search-dropdown__row-body">
        <span className="sc-search-dropdown__row-name">{name}</span>
        {identityMetadata ? (
          <span
            className="sc-search-dropdown__row-meta"
            data-chat-identity-metadata
            title={identityMetadata}
          >
            {identityMetadata}
          </span>
        ) : null}
      </span>
    </button>
  );
}
