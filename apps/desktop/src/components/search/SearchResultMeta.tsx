import { useTranslation } from 'react-i18next';
import { SearchKind, type ResultItem } from '../../gen/proto/domain/search/search_pb';
import { useSocialChatStore } from '../../store/socialChat';
import { actorDisplayName } from '../../store/socialProfileProjection';

/** Read the existing identity projection; result rows own no profile loading. */
export function SearchResultMeta({ item }: { item: ResultItem }) {
  const { t, i18n } = useTranslation('search');
  const displayName = useSocialChatStore(state => state.currentUserPtid === item.authorPtid
    ? state.currentUserProfile?.displayName : state.peerProfiles[item.authorPtid]?.display_name);
  const social = item.kind === SearchKind.SOCIAL_POST || item.kind === SearchKind.SOCIAL_COMMENT;
  const context = social
    ? `${t(item.kind === SearchKind.SOCIAL_COMMENT ? 'search.kind.socialComment' : 'search.kind.socialPost')} · ${actorDisplayName(displayName, t('search.unknownAuthor'))}`
    : item.conversationTitle;
  const timestamp = Number(item.createdAtUnixMs);
  return <span className="pt-search-meta">
    {context}
    {timestamp > 0 && ` · ${new Date(timestamp).toLocaleString(i18n.language, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })}`}
  </span>;
}
