import { shallow } from 'zustand/shallow';
import { usePageActiveStoreSelector } from '../kernel/PageActivityContext';
import { useAppletsStore } from '../store/applets';

type AppletsState = ReturnType<typeof useAppletsStore.getState>;

export function useActiveAppletsStore<TSelected>(
  selector: (state: AppletsState) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  return usePageActiveStoreSelector(useAppletsStore, selector, equality);
}

export function useActiveAppletsSlice<TSelected>(
  selector: (state: AppletsState) => TSelected,
): TSelected {
  return useActiveAppletsStore(selector, shallow);
}
