import { Icon } from '@peers-touch/ui';
import { useMobileI18n } from '../app/mobileI18n';
import { SearchKind, SearchZone } from '../gen/proto/domain/search/search_pb';
import './MobileSearchResult.css';

/** Shared result presentation; identity and execution remain with the caller. */
export function MobileSearchResult({
  resourceId, resourceKey, kind, snippet, title, authorName, conversationTitle,
  zone, createdAtUnixMs, selected, opening, onOpen,
}: {
  resourceId?: string;
  resourceKey: string;
  kind: SearchKind;
  snippet: string;
  title: string;
  authorName: string;
  conversationTitle: string;
  zone: SearchZone;
  createdAtUnixMs: number;
  selected: boolean;
  opening: boolean;
  onOpen: () => void;
}) {
  const { t, language } = useMobileI18n();
  const isSocial = kind === SearchKind.SOCIAL_POST || kind === SearchKind.SOCIAL_COMMENT;
  return (
    <button
      type="button" className={`mobile-search-result${selected ? ' selected' : ''}`}
      data-entity="search-result" data-resource-id={resourceId}
      data-scroll-anchor-id={resourceKey} data-focus-id={resourceKey}
      disabled={opening} onClick={onOpen}
    >
      <span className="mobile-search-result__icon" aria-hidden="true">
        <Icon iconId={isSocial ? 'newspaper' : kind === SearchKind.ATTACHMENT ? 'file-text' : 'message-circle'} size={20} />
      </span>
      <span className="mobile-search-result__body">
        <span className="mobile-search-result__title">{snippet || title}</span>
        {kind === SearchKind.SOCIAL_COMMENT && title ? (
          <span className="mobile-search-result__meta">{title}</span>
        ) : null}
        <span className="mobile-search-result__meta">
          <span>{isSocial ? t(kind === SearchKind.SOCIAL_COMMENT ? 'search.kind.socialComment' : 'search.kind.socialPost') : conversationTitle} · {authorName}</span>
          <span>{t(zone === SearchZone.STATION ? 'search.zone.station' : 'search.zone.device')}</span>
          {createdAtUnixMs > 0 ? <time dateTime={new Date(createdAtUnixMs).toISOString()}>
            {new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(createdAtUnixMs)}
          </time> : null}
        </span>
      </span>
      <Icon iconId="chevron-right" size={18} aria-hidden="true" />
    </button>
  );
}
