// Container component for the search page descriptor — bridges the
// kernel `usePageContext()` hook into `SearchPage`'s prop signature.
// Kept in its own file so `SearchPage.descriptor.tsx` exports only the
// register function (react-refresh requires modules to either export
// only components or only non-components).

import { usePageContext } from '../kernel/usePageContext';
import { SearchPage } from './SearchPage';

export function SearchPageContainer() {
  const { navigation } = usePageContext();
  return <SearchPage onNavigate={navigation.handleSearchNavigate} />;
}
