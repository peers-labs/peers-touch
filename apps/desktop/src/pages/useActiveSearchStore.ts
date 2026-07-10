import { shallow } from 'zustand/shallow';
import { usePageActiveStoreSelector } from '../kernel/PageActivityContext';
import { useSearchStore } from '../store/search';

type SearchState = ReturnType<typeof useSearchStore.getState>;

export function useActiveSearchSlice<TSelected>(
  selector: (state: SearchState) => TSelected,
): TSelected {
  return usePageActiveStoreSelector(useSearchStore, selector, shallow);
}
