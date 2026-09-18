import type { RuntimeDescriptor } from '../kernel/runtime';
import { EVENT, eventBus } from '../kernel/events';
import { useEvaluationStore } from '../store/evaluation';
import {
  useAgentCapabilityStore,
  type AgentCapabilityReadinessInput,
} from '../store/agentCapabilities';
import { useAgentStore } from '../store/agent';
import { log } from '../utils/logger';

const EVALUATION_RECONCILE_INTERVAL_MS = 60_000;
const EVALUATION_EVENT_INTERVAL_MS = 2_000;

let installed = false;
let activeActorPtid: string | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let eventTimer: ReturnType<typeof setInterval> | null = null;
let reconcileInFlight: Promise<void> | null = null;
let queuedReconcileReason:
  | 'bootstrap'
  | 'restart'
  | 'reconcile'
  | 'user'
  | null = null;
let eventInFlight: Promise<void> | null = null;
let unsubscribers: Array<() => void> = [];

async function loadTargetAgents(): Promise<void> {
  await useAgentStore.getState().loadAgents();
  const agentIds = useAgentStore.getState().agents.map((agent) => agent.id);
  await Promise.all(
    agentIds.map((agentId) =>
      useAgentCapabilityStore.getState().loadAgent(agentId),
    ),
  );
}

async function reconcileProjection(
  reason: 'bootstrap' | 'restart' | 'reconcile' | 'user',
): Promise<void> {
  if (!installed || !activeActorPtid) return;
  if (reconcileInFlight) {
    queuedReconcileReason = reason;
    return reconcileInFlight;
  }
  const actorPtid = activeActorPtid;
  const pending = Promise.all([
    useEvaluationStore.getState().loadProjection(actorPtid, reason),
    loadTargetAgents(),
  ]).then(() => undefined);
  reconcileInFlight = pending;
  try {
    await pending;
  } finally {
    if (reconcileInFlight === pending) {
      reconcileInFlight = null;
      const queuedReason = queuedReconcileReason;
      queuedReconcileReason = null;
      if (queuedReason && installed && activeActorPtid === actorPtid) {
        runDetached(
          'queued reconciliation failed',
          () => reconcileProjection(queuedReason),
        );
      }
    }
  }
}

async function consumeEvents(): Promise<void> {
  if (!installed || !activeActorPtid) return;
  if (eventInFlight) return eventInFlight;
  const pending = useEvaluationStore.getState().consumeRunEvents();
  eventInFlight = pending;
  try {
    await pending;
  } finally {
    if (eventInFlight === pending) eventInFlight = null;
  }
}

function runDetached(label: string, operation: () => Promise<void>): void {
  void operation().catch((error) => {
    log.warn('evaluationRuntime', label, { error: String(error) });
  });
}

function installSubscriptions(): void {
  if (unsubscribers.length > 0) return;
  unsubscribers = [
    eventBus.subscribe(
      EVENT.EVALUATION_PROJECTION_INVALIDATED,
      ({ runId, reason }) => {
        if (runId) {
          runDetached(
            'run event refresh failed',
            () => useEvaluationStore.getState().refreshRun(runId),
          );
          return;
        }
        runDetached('projection event refresh failed', () =>
          reconcileProjection('reconcile'));
        log.debug('evaluationRuntime', 'projection invalidated', { reason });
      },
    ),
    eventBus.subscribe(EVENT.REALTIME_RESYNC, () => {
      runDetached('realtime resync failed', () =>
        reconcileProjection('reconcile'));
    }),
  ];
}

function clearSubscriptions(): void {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

function installTimers(): void {
  if (reconcileTimer === null) {
    reconcileTimer = setInterval(() => {
      runDetached('periodic reconciliation failed', () =>
        reconcileProjection('reconcile'));
    }, EVALUATION_RECONCILE_INTERVAL_MS);
  }
  if (eventTimer === null) {
    eventTimer = setInterval(() => {
      runDetached('event consumption failed', consumeEvents);
    }, EVALUATION_EVENT_INTERVAL_MS);
  }
}

function clearTimers(): void {
  if (reconcileTimer !== null) clearInterval(reconcileTimer);
  if (eventTimer !== null) clearInterval(eventTimer);
  reconcileTimer = null;
  eventTimer = null;
}

export function refreshEvaluationProjection(): Promise<void> {
  return reconcileProjection('user');
}

export async function refreshEvaluationTargetProjection(
  agentId: string,
  readinessInput: AgentCapabilityReadinessInput = {},
): Promise<void> {
  if (!installed || !activeActorPtid) return;
  await Promise.all([
    useEvaluationStore.getState().loadProjection(activeActorPtid, 'user'),
    useAgentCapabilityStore.getState().loadAgent(agentId, readinessInput),
  ]);
}

export const evaluationRuntime: RuntimeDescriptor = {
  id: 'evaluation',
  scope: 'session',
  install() {
    if (installed) return;
    installed = true;
    installSubscriptions();
    installTimers();
  },
  teardown() {
    if (!installed) {
      useEvaluationStore.getState().reset();
      return;
    }
    installed = false;
    activeActorPtid = null;
    reconcileInFlight = null;
    queuedReconcileReason = null;
    eventInFlight = null;
    clearSubscriptions();
    clearTimers();
    useEvaluationStore.getState().reset();
  },
  async bootstrap(actorPtid) {
    if (!actorPtid) {
      activeActorPtid = null;
      useEvaluationStore.getState().reset();
      return;
    }
    if (
      activeActorPtid === actorPtid
      && useEvaluationStore.getState().projectionPhase !== 'idle'
    ) return;
    activeActorPtid = actorPtid;
    useEvaluationStore.getState().setActorScope(actorPtid);
    await reconcileProjection('bootstrap');
  },
  async reconcile() {
    await reconcileProjection('reconcile');
  },
};
