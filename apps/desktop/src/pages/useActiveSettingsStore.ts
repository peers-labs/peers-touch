import { shallow } from 'zustand/shallow';
import { useSectionActiveStoreSelector } from '../kernel/SectionActivityContext';
import { useSettingsStore } from '../store/settings';

type SettingsState = ReturnType<typeof useSettingsStore.getState>;

export function useActiveSettingsStore<TSelected>(
  selector: (state: SettingsState) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  return useSectionActiveStoreSelector(useSettingsStore, selector, equality);
}

export function useActiveSettingsSlice<TSelected>(
  selector: (state: SettingsState) => TSelected,
): TSelected {
  return useActiveSettingsStore(selector, shallow);
}
