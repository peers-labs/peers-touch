import { IconButton } from '@peers-touch/ui';
import { useMobileI18n } from '../app/mobileI18n';

export function SearchEntry({ onOpen }: { onOpen: () => void }) {
  const { t } = useMobileI18n();
  return <IconButton actionId="mobile-search-open" iconId="search" iconSize={20}
    density="comfortable" emphasis="quiet"
    data-acceptance-id="mobile-search-open" data-focus-id="search.entry"
    label={t('search.label')} onActivate={onOpen} />;
}
