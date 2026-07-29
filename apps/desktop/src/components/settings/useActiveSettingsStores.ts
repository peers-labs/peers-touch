import { shallow } from 'zustand/shallow';
import { useSectionActiveStoreSelector } from '../../kernel/SectionActivityContext';
import { useFederationStore } from '../../store/federation';
import { useOAuth2Store } from '../../store/oauth2';
import { useProviderStore } from '../../store/provider';

type FederationState = ReturnType<typeof useFederationStore.getState>;
type OAuth2State = ReturnType<typeof useOAuth2Store.getState>;
type ProviderState = ReturnType<typeof useProviderStore.getState>;

export function useActiveFederationStore<TSelected>(
  selector: (state: FederationState) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  return useSectionActiveStoreSelector(useFederationStore, selector, equality);
}

export function useActiveFederationSlice<TSelected>(selector: (state: FederationState) => TSelected): TSelected {
  return useActiveFederationStore(selector, shallow);
}

export function useActiveOAuth2Slice<TSelected>(selector: (state: OAuth2State) => TSelected): TSelected {
  return useSectionActiveStoreSelector(useOAuth2Store, selector, shallow);
}

export function useActiveProviderSlice<TSelected>(selector: (state: ProviderState) => TSelected): TSelected {
  return useSectionActiveStoreSelector(useProviderStore, selector, shallow);
}
