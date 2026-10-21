import { beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '../services/desktop_api';
import { useAgentTopicStore } from './agentTopics';

function durableSession(key: string): Session {
  const now = new Date().toISOString();
  return {
    id: key,
    key,
    agent_name: 'assistant',
    title: 'Accepted topic',
    message_count: 1,
    created_at: now,
    updated_at: now,
  };
}

describe('Agent draft topic promotion', () => {
  beforeEach(() => {
    useAgentTopicStore.getState().resetProjection();
  });

  it('atomically replaces the draft key with the Station conversation key', () => {
    const store = useAgentTopicStore.getState();
    const draft = store.createDraftTopic('agent_1', 'assistant', 'Draft topic');
    store.promoteDraftTopic('agent_1', draft.key, durableSession('conversation_1'));

    const topics = useAgentTopicStore.getState().getTopicsForAgent('agent_1');
    expect(topics.map((topic) => topic.key)).toEqual(['conversation_1']);
    expect(topics[0].title).toBe('Accepted topic');
  });

  it('is idempotent when conversation_created is replayed', () => {
    const store = useAgentTopicStore.getState();
    const draft = store.createDraftTopic('agent_1', 'assistant', 'Draft topic');
    const accepted = durableSession('conversation_1');

    store.promoteDraftTopic('agent_1', draft.key, accepted);
    useAgentTopicStore.getState().promoteDraftTopic('agent_1', draft.key, accepted);

    expect(
      useAgentTopicStore
        .getState()
        .getTopicsForAgent('agent_1')
        .filter((topic) => topic.key === 'conversation_1'),
    ).toHaveLength(1);
  });

  it('replaces an abandoned local draft without changing durable topics', () => {
    const store = useAgentTopicStore.getState();
    store.upsertTopics('agent_1', [durableSession('conversation_1')]);
    store.createDraftTopic('agent_1', 'assistant', 'First draft');
    const replacement = useAgentTopicStore
      .getState()
      .createDraftTopic('agent_1', 'assistant', 'Replacement draft');

    const topics = useAgentTopicStore.getState().getTopicsForAgent('agent_1');
    expect(topics.map((topic) => topic.key)).toEqual([
      replacement.key,
      'conversation_1',
    ]);
  });
});
