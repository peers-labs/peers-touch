import { Search } from 'lucide-react';
import { useMobileI18n } from '../app/mobileI18n';
import './SearchEntry.css';

export function SearchEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useMobileI18n();
  return <button type="button" className="header-action mobile-search-entry"
    data-acceptance-id="mobile-search-open" data-focus-id="search.entry"
    aria-label={t('search.label')} onClick={onOpen}>
    <Search size={20} aria-hidden="true" />
  </button>;
}
