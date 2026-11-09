import { ArrowLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@peers-touch/ui';
import { searchActions } from '../../runtimes/searchRuntime';
import { useSearchStore } from '../../store/search';
import type { Navigation } from '../../types/navigation';

export function SearchReturnBar({ navigation }: { navigation: Navigation }) {
  const visible = useSearchStore(state => state.returnAvailable && !state.open);
  const { t, i18n } = useTranslation('search');
  if (!visible) return null;
  return <div data-search-return style={{
    display: 'flex', alignItems: 'center', gap: 4, height: 36, flexShrink: 0,
    padding: '0 12px', background: 'var(--pt-surface)',
    borderBottom: '1px solid var(--pt-border)',
  }}>
    <Button
      actionId="search-return-back"
      emphasis="quiet"
      density="compact"
      leading={<ArrowLeft size={14} />}
      label={t('search.back')}
      onActivate={() => {
        const origin = useSearchStore.getState().originPage;
        navigation.navigateTo(origin);
        searchActions.open(origin, i18n.language);
      }}
    />
    <Button
      actionId="search-return-dismiss"
      emphasis="quiet"
      density="compact"
      leading={<X size={14} />}
      label={t('search.dismissBack')}
      onActivate={() => useSearchStore.setState({ returnAvailable: false })}
    />
  </div>;
}
