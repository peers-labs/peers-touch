import { shallow } from 'zustand/shallow';
import { usePageActiveStoreSelector } from '../../kernel/PageActivityContext';
import { useAgentStore } from '../../store/agent';
import { useAgentSearchStore } from '../../store/agentSearch';
import { useAgentTopicStore } from '../../store/agentTopics';
import { useChatStore } from '../../store/chat';

type AgentState = ReturnType<typeof useAgentStore.getState>;
type AgentSearchState = ReturnType<typeof useAgentSearchStore.getState>;
type AgentTopicState = ReturnType<typeof useAgentTopicStore.getState>;
type ChatState = ReturnType<typeof useChatStore.getState>;

export function useActiveAgentSlice<TSelected>(selector: (state: AgentState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useAgentStore, selector, shallow);
}

export function useActiveAgentSearchSlice<TSelected>(selector: (state: AgentSearchState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useAgentSearchStore, selector, shallow);
}

export function useActiveAgentTopicSlice<TSelected>(selector: (state: AgentTopicState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useAgentTopicStore, selector, shallow);
}

export function useActiveChatSlice<TSelected>(selector: (state: ChatState) => TSelected): TSelected {
  return usePageActiveStoreSelector(useChatStore, selector, shallow);
}
