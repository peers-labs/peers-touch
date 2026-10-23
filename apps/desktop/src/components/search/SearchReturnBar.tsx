import { Button } from '@lobehub/ui';
import { theme } from 'antd';
import { ArrowLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { searchActions } from '../../runtimes/searchRuntime';
import { useSearchStore } from '../../store/search';
import type { Navigation } from '../../types/navigation';

export function SearchReturnBar({ navigation }: { navigation: Navigation }) {
  const visible = useSearchStore(state => state.returnAvailable && !state.open);
  const { t, i18n } = useTranslation('search');
  const { token } = theme.useToken();
  if (!visible) return null;
  return <div data-search-return style={{
    display: 'flex', alignItems: 'center', gap: 4, height: 36, flexShrink: 0,
    padding: '0 12px', background: token.colorBgContainer,
    borderBottom: `1px solid ${token.colorBorderSecondary}`,
  }}>
    <Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={() => {
      const origin = useSearchStore.getState().originPage;
      navigation.navigateTo(origin);
      searchActions.open(origin, i18n.language);
    }}>{t('search.back')}</Button>
    <Button type="text" size="small" icon={<X size={14} />} aria-label={t('search.dismissBack')}
      onClick={() => useSearchStore.setState({ returnAvailable: false })} />
  </div>;
}
