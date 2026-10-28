import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchStore } from '../../store/search';
import { searchActions } from '../../runtimes/searchRuntime';
import type { Navigation, Page } from '../../types/navigation';

const SearchOverlay = lazy(() => import('./SearchOverlay').then(module => ({ default: module.SearchOverlay })));

export function SearchHost({ page, navigation }: { page: Page; navigation: Navigation }) {
  const open = useSearchStore(state => state.open);
  const { t, i18n } = useTranslation('search');
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k' || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (useSearchStore.getState().open) searchActions.close();
      else searchActions.open(page, i18n.language);
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [page, i18n.language]);
  return <>
    {open && <Suspense fallback={<div role="status" aria-live="polite">{t('search.loading')}</div>}>
      <SearchOverlay navigation={navigation} />
    </Suspense>}
  </>;
}
