import { shallow } from 'zustand/shallow';
import { usePageActiveStoreSelector } from '../../kernel/PageActivityContext';
import { useDiscoveryStore } from '../../store/discovery';
import { useFederationStore } from '../../store/federation';
import { useMomentsStore } from '../../store/moments';
import { useRelationshipsStore } from '../../store/relationships';

type DiscoveryState = ReturnType<typeof useDiscoveryStore.getState>;
type FederationState = ReturnType<typeof useFederationStore.getState>;
type MomentsState = ReturnType<typeof useMomentsStore.getState>;
type RelationshipsState = ReturnType<typeof useRelationshipsStore.getState>;

export function useActiveMomentsStore<TSelected>(
  selector: (state: MomentsState) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  return usePageActiveStoreSelector(useMomentsStore, selector, equality);
}

export function useActiveMomentsSlice<TSelected>(
  selector: (state: MomentsState) => TSelected,
): TSelected {
  return useActiveMomentsStore(selector, shallow);
}

export function useActiveDiscoverySlice<TSelected>(selector: (state: DiscoveryState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useDiscoveryStore, selector, shallow);
}

export function useActiveMomentsFederationSlice<TSelected>(selector: (state: FederationState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useFederationStore, selector, shallow);
}

export function useActiveRelationshipsSlice<TSelected>(selector: (state: RelationshipsState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useRelationshipsStore, selector, shallow);
}
