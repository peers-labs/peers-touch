import { shallow } from 'zustand/shallow';
import { usePageActiveStoreSelector } from '../../kernel/PageActivityContext';
import { useFederationStore } from '../../store/federation';
import { useSessionStore } from '../../store/session';
import { useSettingsStore } from '../../store/settings';
import { useSocialChatStore } from '../../store/socialChat';

type FederationState = ReturnType<typeof useFederationStore.getState>;
type SessionState = ReturnType<typeof useSessionStore.getState>;
type SettingsState = ReturnType<typeof useSettingsStore.getState>;
type SocialChatState = ReturnType<typeof useSocialChatStore.getState>;

export function useActiveSocialChatStore<TSelected>(
  selector: (state: SocialChatState) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  return usePageActiveStoreSelector(useSocialChatStore, selector, equality);
}

export function useActiveSocialChatSlice<TSelected>(
  selector: (state: SocialChatState) => TSelected,
): TSelected {
  return useActiveSocialChatStore(selector, shallow);
}

export function useActiveChatFederationSlice<TSelected>(selector: (state: FederationState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useFederationStore, selector, shallow);
}

export function useActiveChatSessionSlice<TSelected>(selector: (state: SessionState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useSessionStore, selector, shallow);
}

export function useActiveChatSettingsSlice<TSelected>(selector: (state: SettingsState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useSettingsStore, selector, shallow);
}
