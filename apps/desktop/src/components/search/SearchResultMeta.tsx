import { useTranslation } from 'react-i18next';
import { SearchKind, type ResultItem } from '../../gen/proto/domain/search/search_pb';
import { useSocialChatStore } from '../../store/socialChat';
import { actorDisplayName } from '../../store/socialProfileProjection';

/** Read the existing identity projection; result rows own no profile loading. */
export function SearchResultMeta({ item }: { item: ResultItem }) {
  const { t, i18n } = useTranslation('search');
  const social = item.kind === SearchKind.SOCIAL_POST || item.kind === SearchKind.SOCIAL_COMMENT;
  const displayName = useSocialChatStore(state => state.currentUserPtid === item.authorPtid
    ? state.currentUserProfile?.displayName : state.peerProfiles[item.authorPtid]?.display_name);
  const sender = useSocialChatStore(state => !social && item.authorPtid && item.resource
    ? state.getIMSenderProfile(
      state.conversations.find(row => row.conversationId === item.resource?.conversationId)?.kind === 2
        ? 'group' : 'friend',
      item.resource.conversationId, item.authorPtid,
    ).name : '');
  const context = social
    ? `${t(item.kind === SearchKind.SOCIAL_COMMENT ? 'search.kind.socialComment' : 'search.kind.socialPost')} · ${actorDisplayName(displayName, t('search.unknownAuthor'))}`
    : [item.conversationTitle, sender].filter(Boolean).join(' · ');
  const timestamp = Number(item.createdAtUnixMs);
  return <span className="pt-search-meta">
    {context}
    {timestamp > 0 && ` · ${new Date(timestamp).toLocaleString(i18n.language, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })}`}
  </span>;
}
