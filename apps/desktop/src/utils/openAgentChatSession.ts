import type { Agent } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import { useAgentTopicStore } from '../store/agentTopics';
import { useChatStore } from '../store/chat';

interface OpenAgentChatSessionOptions {
  forceNew?: boolean;
  draftTitle?: string;
  reason?: string;
}

function createDraftForAgent(agent: Agent, draftTitle?: string) {
  const title = draftTitle || agent.title || agent.name;
  return useAgentTopicStore.getState().createDraftTopic(agent.id, agent.name, title);
}

export async function openAgentChatSession(agent: Agent, options: OpenAgentChatSessionOptions = {}) {
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

  const topics = topicStore.getTopicsForAgent(agent.id);
  if (topics.length > 0) {
    await chatStore.selectSession(topics[0].key, topics[0]);
    return topics[0];
  }

  const topic = createDraftForAgent(agent, options.draftTitle);
  await chatStore.selectSession(topic.key, topic);
  return topic;
}
