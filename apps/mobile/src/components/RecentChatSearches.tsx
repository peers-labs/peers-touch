import { Clock3, X } from 'lucide-react';
import { useMobileI18n } from '../app/mobileI18n';
import './recent-chat-searches.css';

export function RecentChatSearches({
  queries, onReplay, onRemove, onClear,
}: {
  readonly queries: readonly string[];
  readonly onReplay: (query: string) => void;
  readonly onRemove: (query: string) => void;
  readonly onClear: () => void;
}) {
  const { t } = useMobileI18n();
  if (!queries.length) return null;
  return (
    <section className="recent-chat-searches" aria-label={t('mobile.chat.search.recent')}>
      <div className="recent-chat-searches-heading">
        <strong>{t('mobile.chat.search.recent')}</strong>
        <button type="button" onClick={onClear}>{t('mobile.chat.search.clearHistory')}</button>
      </div>
      {queries.map((query) => (
        <div className="recent-chat-search-row" key={query}>
          <button type="button" className="recent-chat-search-replay" onClick={() => onReplay(query)}>
            <Clock3 size={15} aria-hidden="true" />
            <span>{query}</span>
          </button>
          <button type="button" className="recent-chat-search-remove" aria-label={t('mobile.chat.search.deleteHistory', { query })} onClick={() => onRemove(query)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </section>
  );
}
