import type { RuntimeDescriptor } from '../kernel/runtime';
import { useAgentStore } from '../store/agent';
import { useAgentTopicStore } from '../store/agentTopics';
import { useChatStore } from '../store/chat';
import { useChatArtifactStore } from '../store/chatArtifacts';
import { useSessionGroupStore } from '../store/sessionGroups';
import { log } from '../utils/logger';

const TOPIC_RECONCILE_INTERVAL_MS = 60_000;

let installed = false;
let projectionGeneration = 0;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeAgentSelection: (() => void) | null = null;
const topicReconciles = new Map<string, Promise<void>>();

function reconcileTopics(reason: string): Promise<void> {
  const agentState = useAgentStore.getState();
  const agent = agentState.agents.find((item) => item.name === agentState.selectedAgent);
  if (!agent) return Promise.resolve();
  const existing = topicReconciles.get(agent.id);
  if (existing) return existing;
  const pending = reconcileSelectedAgentTopics(agent, reason, projectionGeneration);
  topicReconciles.set(agent.id, pending);
  const release = () => {
    if (topicReconciles.get(agent.id) === pending) topicReconciles.delete(agent.id);
  };
  void pending.then(release, release);
  return pending;
}

async function reconcileSelectedAgentTopics(
  agent: { id: string; name: string },
  reason: string,
  generation: number,
): Promise<void> {
  log.info('agentTopicRuntime', 'reconciling agent topic projection', { reason });
  const topics = await useAgentTopicStore
    .getState()
    .loadTopicsForAgent(agent.id, reason)
    .catch(() => null);
  // The store preserves the last accepted projection and exposes retry state.
  if (topics === null) return;

  const selectedAgent = useAgentStore.getState();
  if (
    generation !== projectionGeneration
    || selectedAgent.selectedAgent !== agent.name
    || !selectedAgent.agents.some((item) => item.id === agent.id)
  ) {
    return;
  }

  const chatState = useChatStore.getState();
  chatState.mergeSessions(topics);

  const currentSession = useChatStore
    .getState()
    .sessions.find((session) => session.key === useChatStore.getState().currentSessionKey);
  if (
    currentSession
    && (currentSession.agent_name === agent.id || currentSession.agent_name === agent.name)
  ) {
    // Cache bootstrap belongs to cold entry. Steady reconciliation reads
    // Station once instead of publishing cache, background sync and refresh.
    if (reason === 'bootstrap') await useChatStore.getState().bootstrapSession();
    await useChatStore.getState().syncMessages();
    await useChatStore.getState().syncTurnQueue(currentSession.key);
    await useChatArtifactStore.getState().load(currentSession.key).catch(() => []);
    return;
  }
  if (topics[0]) {
    await useChatStore.getState().selectSession(topics[0].key, topics[0]);
    await useChatStore.getState().syncMessages();
    await useChatStore.getState().syncTurnQueue(topics[0].key);
    await useChatArtifactStore.getState().load(topics[0].key).catch(() => []);
    return;
  }

  const draft = useAgentTopicStore
    .getState()
    .ensureDraftTopic(agent.id, agent.name, '');
  useChatStore.getState().mergeSessions([draft]);
  await useChatStore.getState().selectSession(draft.key, draft);
}

function installTimer(): void {
  if (reconcileTimer != null) return;
  reconcileTimer = setInterval(() => {
    void reconcileTopics('periodic');
  }, TOPIC_RECONCILE_INTERVAL_MS);
}

function clearTimer(): void {
  if (reconcileTimer == null) return;
  clearInterval(reconcileTimer);
  reconcileTimer = null;
}

export const agentTopicRuntime: RuntimeDescriptor = {
  id: 'agent-topic',
  scope: 'session',
  install() {
    if (installed) return;
    installed = true;
    projectionGeneration += 1;
    useSessionGroupStore.getState().loadGroups();
    unsubscribeAgentSelection = useAgentStore.subscribe((state, previous) => {
      const selectedId = state.agents.find((agent) => agent.name === state.selectedAgent)?.id;
      const previousId = previous.agents.find((agent) => agent.name === previous.selectedAgent)?.id;
      if (selectedId === previousId) return;
      void reconcileTopics('agent-selection');
    });
    installTimer();
  },
  teardown() {
    installed = false;
    projectionGeneration += 1;
    topicReconciles.clear();
    clearTimer();
    unsubscribeAgentSelection?.();
    unsubscribeAgentSelection = null;
    useAgentTopicStore.getState().resetProjection();
    useChatArtifactStore.getState().clear();
  },
  async bootstrap(actorId) {
    if (!actorId) return;
    await reconcileTopics('bootstrap');
  },
  async reconcile(reason: string) {
    await reconcileTopics(reason);
  },
};
