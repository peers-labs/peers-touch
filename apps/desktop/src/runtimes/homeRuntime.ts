import type { RuntimeDescriptor } from '../kernel/runtime';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import { HomeWorkKind } from '../gen/proto/domain/agent/home_pb';
import { api } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import { useAgentTopicStore } from '../store/agentTopics';
import {
  useHomeStore,
  type HomeRecentWorkView,
} from '../store/home';
import { useChatStore } from '../store/chat';
import { log } from '../utils/logger';

const HOME_RECONCILE_INTERVAL_MS = 60_000;

let installed = false;
let runtimeGeneration = 0;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconcileInFlight: Promise<void> | null = null;
let unsubscribers: Array<() => void> = [];

function currentAgentNamesById(): Record<string, string> {
  return Object.fromEntries(
    useAgentStore.getState().agents.map((agent) => [agent.id, agent.name]),
  );
}

async function loadHomeProjection(reason: string): Promise<void> {
  if (!installed) return;
  if (reconcileInFlight) return reconcileInFlight;

  const generation = runtimeGeneration;
  const store = useHomeStore.getState();
  store.beginLoad();
  const pending = (async () => {
    try {
      await useAgentStore.getState().loadAgents();
      const afterRevision = useHomeStore.getState().projection?.revision ?? 0n;
      const projection = await api.getHomeWorkProjection(afterRevision);
      if (!installed || generation !== runtimeGeneration) return;
      useHomeStore.getState().applyProjection(
        projection,
        currentAgentNamesById(),
      );
      log.info('homeRuntime', 'Home projection reconciled', {
        reason,
        revision: projection.revision.toString(),
      });
    } catch (error) {
      if (!installed || generation !== runtimeGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      useHomeStore.getState().failLoad(message);
      log.warn('homeRuntime', 'Home projection reconcile failed', {
        reason,
        error: message,
      });
    }
  });
  reconcileInFlight = pending();
  try {
    await reconcileInFlight;
  } finally {
    reconcileInFlight = null;
  }
}

function requestReconcile(reason: string): void {
  void loadHomeProjection(reason);
}

function installReconcileSources(): void {
  if (unsubscribers.length > 0) return;
  unsubscribers = [
    eventBus.subscribe(EVENT.REALTIME_RESYNC, () => {
      requestReconcile('realtime-resync');
    }),
    useAgentStore.subscribe((state, previous) => {
      if (state.agents !== previous.agents) {
        requestReconcile('agents-changed');
      }
    }),
    useAgentTopicStore.subscribe((state, previous) => {
      if (state.topicsByAgentId !== previous.topicsByAgentId) {
        requestReconcile('topics-changed');
      }
    }),
  ];
}

function clearReconcileSources(): void {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function installReconcileTimer(): void {
  if (reconcileTimer !== null) return;
  reconcileTimer = setInterval(() => {
    requestReconcile('periodic');
  }, HOME_RECONCILE_INTERVAL_MS);
}

function clearReconcileTimer(): void {
  if (reconcileTimer === null) return;
  clearInterval(reconcileTimer);
  reconcileTimer = null;
}

export function refreshHomeProjection(reason = 'user-retry'): Promise<void> {
  return loadHomeProjection(reason);
}

export async function openHomeConversation(work: HomeRecentWorkView): Promise<void> {
  if (work.kind !== HomeWorkKind.CHAT) {
    throw new Error('agent.home.unsupportedWorkKind');
  }
  const agentState = useAgentStore.getState();
  const agent = agentState.agents.find((item) => item.id === work.agentId);
  if (!agent) {
    throw new Error('agent.home.agentUnavailable');
  }
  agentState.setAgentSurface(agent.name, 'chat');
  agentState.setSelectedAgent(agent.name);
  await useChatStore.getState().selectSession(work.workId);
}

export const homeRuntime: RuntimeDescriptor = {
  id: 'home',
  scope: 'session',
  install() {
    if (installed) return;
    installed = true;
    runtimeGeneration += 1;
    installReconcileSources();
    installReconcileTimer();
  },
  teardown() {
    installed = false;
    runtimeGeneration += 1;
    clearReconcileTimer();
    clearReconcileSources();
    reconcileInFlight = null;
    useHomeStore.getState().reset();
  },
  async bootstrap(actorId) {
    if (!actorId) return;
    await loadHomeProjection('bootstrap');
  },
  async reconcile(reason) {
    await loadHomeProjection(reason);
  },
};
