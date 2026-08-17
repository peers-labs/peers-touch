import type { RuntimeDescriptor } from '../kernel/runtime';
import { useAgentStore } from '../store/agent';
import { useAgentTopicStore } from '../store/agentTopics';
import { useChatStore } from '../store/chat';
import { useSessionGroupStore } from '../store/sessionGroups';
import { log } from '../utils/logger';

const TOPIC_RECONCILE_INTERVAL_MS = 60_000;

let installed = false;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeAgentSelection: (() => void) | null = null;

async function reconcileTopics(reason: string): Promise<void> {
  log.info('agentTopicRuntime', 'reconciling agent topic projection', { reason });
  const agentState = useAgentStore.getState();
  const agent = agentState.agents.find((item) => item.name === agentState.selectedAgent);
  if (!agent) return;

  const topics = await useAgentTopicStore
    .getState()
    .loadTopicsForAgent(agent.id, reason);
  const chatState = useChatStore.getState();
  chatState.mergeSessions(topics);

  const currentSession = useChatStore
    .getState()
    .sessions.find((session) => session.key === useChatStore.getState().currentSessionKey);
  if (currentSession?.agent_name === agent.name) {
    await useChatStore.getState().bootstrapSession();
    return;
  }
  if (topics[0]) {
    await useChatStore.getState().selectSession(topics[0].key, topics[0]);
    return;
  }

  useChatStore.getState().newSession();
  const draft = useChatStore
    .getState()
    .sessions.find((session) => session.key === useChatStore.getState().currentSessionKey);
  if (draft) {
    useAgentTopicStore.getState().upsertTopics(agent.id, [draft]);
  }
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
    useSessionGroupStore.getState().loadGroups();
    unsubscribeAgentSelection = useAgentStore.subscribe((state, previous) => {
      if (state.selectedAgent === previous.selectedAgent && state.agents === previous.agents) {
        return;
      }
      void reconcileTopics('agent-selection');
    });
    installTimer();
  },
  teardown() {
    installed = false;
    clearTimer();
    unsubscribeAgentSelection?.();
    unsubscribeAgentSelection = null;
    useAgentTopicStore.getState().resetProjection();
  },
  async bootstrap(actorId) {
    if (!actorId) return;
    await reconcileTopics('bootstrap');
  },
  async reconcile(reason: string) {
    await reconcileTopics(reason);
  },
};
