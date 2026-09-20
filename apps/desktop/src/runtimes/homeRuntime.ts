import type { RuntimeDescriptor } from '../kernel/runtime';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import { HomeWorkKind } from '../gen/proto/domain/agent/home_pb';
import { api } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import {
  useHomeStore,
  type HomePinnedAgentView,
  type HomeRecentWorkView,
} from '../store/home';
import { useChatStore } from '../store/chat';
import { useTaskStore } from '../store/tasks';
import { log } from '../utils/logger';

const HOME_RECONCILE_INTERVAL_MS = 60_000;
const HOME_RUNTIME_PROFILE_ID = 'modern-chat-agent-v1';

let installed = false;
let runtimeGeneration = 0;
let activeActorId: string | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let reconcileInFlight: Promise<void> | null = null;
let unsubscribers: Array<() => void> = [];

function homeCommandKey(kind: 'chat' | 'task'): string {
  const id = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `home-${kind}-${id}`;
}

async function loadHomeProjection(reason: string): Promise<void> {
  if (!installed) return;
  if (reconcileInFlight) return reconcileInFlight;

  const generation = runtimeGeneration;
  const store = useHomeStore.getState();
  store.beginLoad();
  const pending = (async () => {
    try {
      const afterRevision = useHomeStore.getState().projection?.revision ?? 0n;
      const projection = await api.getHomeWorkProjection(afterRevision);
      if (!installed || generation !== runtimeGeneration) return;
      useHomeStore.getState().applyProjection(projection);
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
  })();
  reconcileInFlight = pending;
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
  if (!work.agentName) {
    throw new Error('agent.home.agentUnavailable');
  }
  agentState.setAgentSurface(work.agentName, 'chat');
  agentState.setSelectedAgent(work.agentName);
  await useChatStore.getState().selectSession(work.workId);
}

export async function submitHomeChat(
  agent: HomePinnedAgentView,
  input: string,
  clientIdempotencyKey = homeCommandKey('chat'),
): Promise<HomeRecentWorkView> {
  const response = await api.submitHomeChatCommand({
    agentId: agent.agentId,
    input,
    runtimeProfileId: HOME_RUNTIME_PROFILE_ID,
    clientIdempotencyKey,
    expectedAgentVersion: agent.agentVersion,
    readinessSnapshotId: agent.readinessSnapshotId,
  });
  const work: HomeRecentWorkView = {
    workId: response.conversationId,
    kind: HomeWorkKind.CHAT,
    agentId: agent.agentId,
    agentName: agent.agentName,
    title: input,
    updatedAt: new Date().toISOString(),
  };
  void refreshHomeProjection('chat-submitted');
  return work;
}

export async function submitHomeTask(
  agent: HomePinnedAgentView,
  input: string,
  clientIdempotencyKey = homeCommandKey('task'),
): Promise<string> {
  const response = await api.submitHomeTaskCommand({
    agentId: agent.agentId,
    input,
    runtimeProfileId: HOME_RUNTIME_PROFILE_ID,
    clientIdempotencyKey,
    expectedAgentVersion: agent.agentVersion,
    readinessSnapshotId: agent.readinessSnapshotId,
  });
  void refreshHomeProjection('task-submitted');
  useTaskStore.getState().setActiveTask(response.taskId);
  return response.taskId;
}

export function openHomeTask(taskId: string): void {
  useTaskStore.getState().setActiveTask(taskId);
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
    activeActorId = null;
    useHomeStore.getState().reset();
  },
  async bootstrap(actorId) {
    if (!actorId) {
      activeActorId = null;
      useHomeStore.getState().reset();
      return;
    }
    if (activeActorId !== actorId) {
      activeActorId = actorId;
      runtimeGeneration += 1;
      reconcileInFlight = null;
      useHomeStore.getState().reset();
    }
    await loadHomeProjection('bootstrap');
  },
  async reconcile(reason) {
    await loadHomeProjection(reason);
  },
};
