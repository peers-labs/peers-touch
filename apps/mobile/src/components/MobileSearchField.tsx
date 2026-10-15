import { Input, Spin } from 'antd';
import { Search } from 'lucide-react';
import { useMobileI18n } from '../app/mobileI18n';
import './mobile-search-field.css';

/** One search intention has one frame, one focus state and a stable action slot. */
export function MobileSearchField({
  query, placeholder, onChange, onSearch, onFocus, loading = false, className = '',
}: {
  readonly query: string;
  readonly placeholder: string;
  readonly onChange: (query: string) => void;
  readonly onSearch: (query: string) => void;
  readonly onFocus?: () => void;
  readonly loading?: boolean;
  readonly className?: string;
}) {
  const { t } = useMobileI18n();
  return (
    <form className={`mobile-search-field ${className}`} role="search"
      onSubmit={(event) => { event.preventDefault(); if (!loading) onSearch(query); }}>
      <Input type="search" variant="borderless" value={query}
        onChange={(event) => onChange(event.target.value)} onFocus={onFocus}
        prefix={<Search size={16} />} placeholder={placeholder} aria-label={placeholder}
        allowClear autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
        enterKeyHint="search"
      />
      <button type="submit" className="ant-input-search-btn" disabled={loading}
        aria-label={t('common.action.search')}>
        {loading ? <Spin size="small" /> : <Search size={18} />}
      </button>
    </form>
  );
}
