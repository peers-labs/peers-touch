import type { Agent } from './desktop_api';
import { useAgentStore } from '../store/agent';
import { useAgentTopicStore, type AgentTopic } from '../store/agentTopics';
import { useChatStore } from '../store/chat';

export interface OpenAgentChatSessionOptions {
  forceNew?: boolean;
  forceReload?: boolean;
  draftTitle?: string;
  reason?: string;
}

function createDraftForAgent(agent: Agent, draftTitle?: string): AgentTopic {
  const title = draftTitle || agent.title || agent.name;
  return useAgentTopicStore.getState().createDraftTopic(agent.id, agent.name, title);
}

function isStillSelected(agent: Agent): boolean {
  return useAgentStore.getState().selectedAgent === agent.name;
}

export async function openAgentChatSession(
  agent: Agent,
  options: OpenAgentChatSessionOptions = {},
): Promise<AgentTopic | null> {
  const agentStore = useAgentStore.getState();
  const topicStore = useAgentTopicStore.getState();
  const chatStore = useChatStore.getState();

  agentStore.setAgentSurface(agent.name, 'chat');
  agentStore.setSelectedAgent(agent.name);

  if (options.forceNew) {
    const topic = createDraftForAgent(agent, options.draftTitle);
    await chatStore.selectSession(topic.key, topic);
    return topic;
  }

  let topics = topicStore.getTopicsForAgent(agent.id);
  if (options.forceReload || topics.length === 0) {
    try {
      topics = await topicStore.loadTopicsForAgent(
        agent.id,
        options.reason || 'open-agent-chat',
      );
    } catch (error) {
      if (isStillSelected(agent)) {
        const acceptedTopics = topicStore.getTopicsForAgent(agent.id);
        const fallback = acceptedTopics[0] ?? topicStore.ensureDraftTopic(
          agent.id,
          agent.name,
          options.draftTitle || agent.title || agent.name,
        );
        chatStore.mergeSessions([fallback]);
        await chatStore.selectSession(fallback.key, fallback);
      }
      throw error;
    }
  }

  if (!isStillSelected(agent)) return null;

  chatStore.mergeSessions(topics);
  const currentTopic = topics.find(
    (topic) => topic.key === useChatStore.getState().currentSessionKey,
  );
  const topic = currentTopic ?? topics[0];
  if (topic) {
    await chatStore.selectSession(topic.key, topic);
    return topic;
  }

  const draft = useAgentTopicStore
    .getState()
    .ensureDraftTopic(
      agent.id,
      agent.name,
      options.draftTitle || agent.title || agent.name,
    );
  useChatStore.getState().mergeSessions([draft]);
  await useChatStore.getState().selectSession(draft.key, draft);
  return draft;
}
