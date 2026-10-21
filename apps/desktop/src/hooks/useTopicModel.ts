import { useCallback } from 'react';
import { toast } from '@lobehub/ui';
import { useAgentStore, resolveAvailableModelSelection } from '../store/agent';
import { useAgentTopicStore } from '../store/agentTopics';
import { useChatStore } from '../store/chat';
import { log } from '../utils/logger';

/** Settings owns defaults; the selected Topic owns an optional composite override. */
export function useTopicModel() {
  const key = useChatStore((state) => state.currentSessionKey);
  const topic = useAgentTopicStore((state) => Object.values(state.topicsByAgentId)
    .flat().find((item) => item.key === key));
  const models = useAgentStore((state) => state.availableModels);
  const defaultModel = useAgentStore((state) => state.defaultModel);
  const defaultProvider = useAgentStore((state) => state.defaultProviderId);
  const selection = resolveAvailableModelSelection(
    models, topic?.model_override || '', topic?.provider_override || '',
    defaultModel, defaultProvider,
  );
  const setSelectedModel = useCallback((model: string, provider = '') => {
    void useAgentTopicStore.getState().setTopicModel(key, model, provider)
      .catch((error: unknown) => {
        log.error('agentTopics', 'Failed to persist Topic model selection', {
          key, error: String(error),
        });
        useAgentStore.setState({ error: String(error) });
        toast.error(error instanceof Error ? error.message : String(error));
      });
  }, [key]);
  return {
    selectedModel: selection.modelId,
    selectedProviderId: selection.providerId,
    setSelectedModel,
  };
}
