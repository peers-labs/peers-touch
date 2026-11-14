import type { RuntimeDescriptor } from '../kernel/runtime';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import {
  api,
  streamAgentAuthorityEvents,
  type AgentCapabilitySessionList,
  type AgentAuthorityStreamPayload,
} from '../services/desktop_api';
import {
  resolveAvailableModelSelection,
  useAgentStore,
} from '../store/agent';
import { useAgentTopicStore } from '../store/agentTopics';
import { useChatStore } from '../store/chat';
import { createAgentDraftKey } from '../store/agentDraft';
import {
  useAgentCapabilityStore,
  type AgentCapabilityState,
} from '../store/agentCapabilities';
import { useAgentConnectorStore } from '../store/agentConnectors';
import { useMCPStore } from '../store/mcp';
import { useProviderStore } from '../store/provider';
import { useSkillStore } from '../store/skill';
import { useToolStore } from '../store/tool';
import { log } from '../utils/logger';

const CAPABILITY_RECONCILE_INTERVAL_MS = 60_000;
const SESSION_WARMUP_INTERVAL_MS = 1_000;
const SESSION_WARMUP_MAX_INTERVAL_MS = 10_000;
// After a renderer reload the identity session is restored in tens of
// milliseconds, but the capability worker re-registers its lease a few
// seconds later. Warmup polls only the session roster through that gap so
// composer readiness converges without waiting for the periodic
// reconciliation. In environments where the executor never registers
// (identity activation unavailable) the poll backs off and MUST NOT reload
// the full provider/agent/catalog projection.
const SESSION_WARMUP_ATTEMPTS = 20;
const AGENT_PROJECTION_CONCURRENCY = 2;
const MAX_AUTHORITY_STREAMS = 4;

let installed = false;
let runtimeGeneration = 0;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let warmupTimer: ReturnType<typeof setTimeout> | null = null;
let warmupAttempts = 0;
let warmupIntervalMs = SESSION_WARMUP_INTERVAL_MS;
let fullLoadInFlight: Promise<void> | null = null;
let runtimeUnsubscribers: Array<() => void> = [];
const authorityStreams = new Map<string, AbortController>();

export type CapabilitySession = AgentCapabilitySessionList['sessions'][number];
type AgentCapabilityProjectionStore = Pick<
  AgentCapabilityState,
  'loadCatalog' | 'loadKnowledgeDescriptors' | 'loadAgent'
>;
export interface AgentCapabilityRuntimeSelection {
  agentId: string;
  providerId: string;
  modelId: string;
}

function capabilitySessionExpiresAtMs(session: CapabilitySession): number {
  if (!session.expires_at) return 0;
  return (
    session.expires_at.seconds * 1_000
    + Math.floor(session.expires_at.nanos / 1_000_000)
  );
}

export function isLiveDesktopCapabilitySession(
  session: CapabilitySession,
  nowMs = Date.now(),
): boolean {
  return Boolean(session.session_id)
    && session.platform === 'CLIENT_PLATFORM_DESKTOP'
    && capabilitySessionExpiresAtMs(session) > nowMs;
}

export function selectActiveCapabilitySession(
  sessions: readonly CapabilitySession[],
  nowMs = Date.now(),
): CapabilitySession | undefined {
  return sessions
    .filter((session) => isLiveDesktopCapabilitySession(session, nowMs))
    .sort((left, right) => {
      const expiryDelta =
        capabilitySessionExpiresAtMs(right) - capabilitySessionExpiresAtMs(left);
      if (expiryDelta !== 0) return expiryDelta;
      return right.lease_revision - left.lease_revision;
    })[0];
}

// Resolves the session a turn must pin: the readiness-selected session when
// it is still live in Station's session list, otherwise the current live
// selection. Returns undefined when no desktop executor is registered, in
// which case client-owned capabilities are unavailable and the composer gate
// blocks dispatch rather than pinning an orphaned session.
export function resolvePinnedClientCapabilitySessionId(
  readinessSelectedSessionId: string | undefined,
  sessions: readonly CapabilitySession[] = useAgentCapabilityStore.getState().capabilitySessions,
  nowMs = Date.now(),
): string | undefined {
  if (
    readinessSelectedSessionId
    && sessions.some(
      (session) =>
        session.session_id === readinessSelectedSessionId
        && isLiveDesktopCapabilitySession(session, nowMs),
    )
  ) {
    return readinessSelectedSessionId;
  }
  return selectActiveCapabilitySession(sessions, nowMs)?.session_id;
}

function clearCapabilitySessionWarmup(): void {
  if (warmupTimer !== null) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  warmupAttempts = 0;
  warmupIntervalMs = SESSION_WARMUP_INTERVAL_MS;
}

// Polls only the capability session roster (one IPC). Warmup must never run
// the full projection load: when identity activation stays unavailable the
// old behaviour re-issued providers/models/agents/applets/connectors/MCP/
// skills/tools every second for the whole session, flooding IPC and the
// renderer event loop.
async function pollCapabilitySessions(
  generation: number,
): Promise<CapabilitySession | undefined> {
  const listed = await api.listAgentCapabilitySessions();
  if (!installed || generation !== runtimeGeneration) return undefined;
  useAgentCapabilityStore.getState().setCapabilitySessions(listed.sessions);
  return selectActiveCapabilitySession(listed.sessions);
}

function armCapabilitySessionWarmup(generation: number): void {
  if (!installed || warmupTimer !== null) return;
  if (warmupAttempts >= SESSION_WARMUP_ATTEMPTS) {
    // This arming window is exhausted. The periodic full load re-arms.
    warmupAttempts = 0;
    warmupIntervalMs = SESSION_WARMUP_INTERVAL_MS;
    return;
  }
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    if (!installed || generation !== runtimeGeneration) return;
    warmupAttempts += 1;
    void (async () => {
      try {
        const activeSession = await pollCapabilitySessions(generation);
        if (!installed || generation !== runtimeGeneration) return;
        if (activeSession) {
          // The executor just registered: one full projection load binds
          // catalog/authority state to the live session.
          clearCapabilitySessionWarmup();
          await requestFullCapabilityLoad('capability-session-live');
          return;
        }
      } catch (error) {
        log.warn('agentCapabilityRuntime', 'capability session warmup poll failed', {
          attempt: warmupAttempts,
          error: String(error),
        });
      }
      warmupIntervalMs = Math.min(
        Math.round(warmupIntervalMs * 1.5),
        SESSION_WARMUP_MAX_INTERVAL_MS,
      );
      armCapabilitySessionWarmup(generation);
    })();
  }, warmupIntervalMs);
}

export async function reconcileAgentCapabilityProjection(
  authorityStore: AgentCapabilityProjectionStore,
  agentIds: readonly string[],
  clientCapabilitySessionId?: string,
  runtimeSelection?: AgentCapabilityRuntimeSelection,
): Promise<void> {
  const failures: unknown[] = new Array(agentIds.length);
  let nextAgentIndex = 0;
  const reconcileAgents = Array.from(
    {
      length: Math.min(AGENT_PROJECTION_CONCURRENCY, agentIds.length),
    },
    async () => {
      while (nextAgentIndex < agentIds.length) {
        const index = nextAgentIndex;
        nextAgentIndex += 1;
        try {
          await authorityStore.loadAgent(agentIds[index], {
            clientCapabilitySessionId,
            providerId: runtimeSelection?.agentId === agentIds[index]
              ? runtimeSelection.providerId
              : undefined,
            modelId: runtimeSelection?.agentId === agentIds[index]
              ? runtimeSelection.modelId
              : undefined,
          });
        } catch (error) {
          failures[index] = error;
        }
      }
    },
  );
  const [globalProjection, agentProjection] = await Promise.allSettled([
    Promise.all([
      authorityStore.loadCatalog(),
      authorityStore.loadKnowledgeDescriptors(),
    ]),
    Promise.all(reconcileAgents),
  ]);
  if (globalProjection.status === 'rejected') {
    throw globalProjection.reason;
  }
  if (agentProjection.status === 'rejected') {
    throw agentProjection.reason;
  }
  const firstFailure = failures.find((failure) => failure !== undefined);
  if (firstFailure !== undefined) {
    throw firstFailure;
  }
}

export function selectAuthorityStreamAgentIds(
  agents: ReadonlyArray<{ id: string; name: string }>,
  selectedAgentName: string,
): string[] {
  const selectedAgentId = agents
    .find((agent) => agent.name === selectedAgentName)
    ?.id.trim();
  return Array.from(new Set([
    selectedAgentId,
    ...agents.map((agent) => agent.id.trim()),
  ].filter((agentId): agentId is string => Boolean(agentId))))
    .slice(0, MAX_AUTHORITY_STREAMS);
}

async function runFullCapabilityLoad(
  reason: string,
  generation: number,
): Promise<void> {
  if (!installed) return;
  log.info('agentCapabilityRuntime', 'loading agent capability projections', { reason });
  const [listedCapabilitySessions] = await Promise.all([
    api.listAgentCapabilitySessions(),
    Promise.all([
      useProviderStore.getState().loadProviders(),
      useAgentStore.getState().loadModels(),
      useAgentStore.getState().loadAgents(),
      useAgentStore.getState().loadApplets(),
      useAgentConnectorStore.getState().loadConnectors(),
      useMCPStore.getState().loadServers(),
      useSkillStore.getState().loadSkills(),
      useToolStore.getState().loadTools(),
    ]),
  ]);
  if (!installed || generation !== runtimeGeneration) return;
  const capabilityStore = useAgentCapabilityStore.getState();
  capabilityStore.setCapabilitySessions(listedCapabilitySessions.sessions);
  const activeSession = selectActiveCapabilitySession(
    listedCapabilitySessions.sessions,
  );
  if (activeSession) {
    clearCapabilitySessionWarmup();
  } else {
    armCapabilitySessionWarmup(generation);
  }

  const authorityStore = capabilityStore;
  const agentState = useAgentStore.getState();
  const selectedAgent = agentState.agents.find(
    (agent) => agent.name === agentState.selectedAgent,
  );
  const selectedTopic = selectedAgent
    ? useAgentTopicStore.getState()
      .getTopicsForAgent(selectedAgent.id)
      .find((topic) => topic.key === useChatStore.getState().currentSessionKey)
    : undefined;
  const modelSelection = resolveAvailableModelSelection(
    agentState.availableModels,
    selectedTopic?.model_override ?? '',
    selectedTopic?.provider_override ?? '',
    agentState.defaultModel,
    agentState.defaultProviderId,
  );
  const runtimeSelection = selectedAgent
    && modelSelection.providerId
    && modelSelection.modelId
    ? {
        agentId: selectedAgent.id,
        providerId: modelSelection.providerId,
        modelId: modelSelection.modelId,
      }
    : undefined;
  const agentIds = selectedAgent?.id.trim() ? [selectedAgent.id.trim()] : [];
  syncAuthorityStreams(selectAuthorityStreamAgentIds(
    agentState.agents,
    agentState.selectedAgent,
  ));
  await reconcileAgentCapabilityProjection(
    authorityStore,
    agentIds,
    activeSession?.session_id,
    runtimeSelection,
  );
}

// Full projection loads are identical work: overlapping triggers (periodic
// timer, selection events, authority invalidation arriving during an ongoing
// load) join the in-flight run instead of stacking duplicate IPC storms.
function requestFullCapabilityLoad(reason: string): Promise<void> {
  if (fullLoadInFlight) return fullLoadInFlight;
  const generation = runtimeGeneration;
  const inFlight = runFullCapabilityLoad(reason, generation);
  const guard: Promise<void> = inFlight
    .catch((error) => {
      log.warn('agentCapabilityRuntime', 'capability projection load failed', {
        reason,
        error: String(error),
      });
    })
    .then(() => undefined)
    .finally(() => {
      // A generation that reinstalled the runtime may own a newer load.
      if (fullLoadInFlight === guard) fullLoadInFlight = null;
    });
  fullLoadInFlight = guard;
  // The originating caller observes rejection; concurrent joiners share the
  // guarded settlement.
  return inFlight;
}

export function authorityEventAgentId(
  payload: AgentAuthorityStreamPayload,
): string {
  if (payload.event !== 'agent.authority.invalidated') return '';
  const envelope = payload.data.payload;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return '';
  }
  const agentId = (envelope as Record<string, unknown>).agent_id;
  return typeof agentId === 'string' ? agentId.trim() : '';
}

function syncAuthorityStreams(agentIds: readonly string[]): void {
  const desired = new Set(agentIds);
  for (const [agentId, controller] of authorityStreams) {
    if (desired.has(agentId)) continue;
    controller.abort();
    authorityStreams.delete(agentId);
  }
  for (const agentId of desired) {
    if (authorityStreams.has(agentId)) continue;
    const controller = streamAgentAuthorityEvents(
      agentId,
      (payload) => {
        const changedAgentId = authorityEventAgentId(payload);
        if (changedAgentId !== agentId || !installed) return;
        void requestFullCapabilityLoad('authority-invalidated').catch((error) => {
          log.warn('agentCapabilityRuntime', 'authority event refresh failed', {
            agentId,
            error: String(error),
          });
        });
      },
      (error) => {
        log.warn('agentCapabilityRuntime', 'authority event stream failed', {
          agentId,
          error: String(error),
        });
      },
    );
    authorityStreams.set(agentId, controller);
  }
}

function clearAuthorityStreams(): void {
  authorityStreams.forEach((controller) => controller.abort());
  authorityStreams.clear();
}

function installReconcileTimer(): void {
  if (reconcileTimer !== null) return;
  reconcileTimer = setInterval(() => {
    void requestFullCapabilityLoad('periodic').catch((error) => {
      log.warn('agentCapabilityRuntime', 'periodic reconciliation failed', {
        error: String(error),
      });
    });
  }, CAPABILITY_RECONCILE_INTERVAL_MS);
}

function clearReconcileTimer(): void {
  if (reconcileTimer === null) return;
  clearInterval(reconcileTimer);
  reconcileTimer = null;
}

function installProjectionInvalidation(): void {
  if (runtimeUnsubscribers.length > 0) return;
  const reconcile = (reason: string) => {
    void requestFullCapabilityLoad(reason).catch((error) => {
      log.warn('agentCapabilityRuntime', 'event reconciliation failed', {
        reason,
        error: String(error),
      });
    });
  };
  runtimeUnsubscribers = [
    useAgentStore.subscribe((state, previous) => {
      const remaining = new Set(state.agents.map((agent) => agent.id));
      const removed = previous.agents.filter((agent) => !remaining.has(agent.id));
      for (const agent of removed) {
        const topicState = useAgentTopicStore.getState();
        const keys = [
          ...(topicState.topicsByAgentId[agent.id] ?? []).map((topic) => topic.key),
          ...useChatStore.getState().sessions
            .filter((session) => session.agent_name === agent.name || session.agent_name === agent.id)
            .map((session) => session.key),
          createAgentDraftKey(agent.id),
        ];
        topicState.discardAgentProjection(agent.id);
        void useChatStore.getState().purgeSessions([...new Set(keys)]);
      }
      if (
        state.selectedAgent !== previous.selectedAgent
        || state.defaultModel !== previous.defaultModel
        || state.defaultProviderId !== previous.defaultProviderId
      ) {
        reconcile('agent-or-default-model-selection');
      }
    }),
    useAgentTopicStore.subscribe((state, previous) => {
      const sessionKey = useChatStore.getState().currentSessionKey;
      const activeAgentId = state.activeAgentId;
      const current = (state.topicsByAgentId[activeAgentId] ?? [])
        .find((topic) => topic.key === sessionKey);
      const prior = (previous.topicsByAgentId[previous.activeAgentId] ?? [])
        .find((topic) => topic.key === sessionKey);
      if (
        state.activeAgentId !== previous.activeAgentId
        || current?.provider_override !== prior?.provider_override
        || current?.model_override !== prior?.model_override
      ) {
        reconcile('topic-model-selection');
      }
    }),
    useChatStore.subscribe((state, previous) => {
      if (state.currentSessionKey !== previous.currentSessionKey) {
        reconcile('topic-selection');
      }
    }),
    eventBus.subscribe(EVENT.OAUTH_CONNECTIONS_CHANGED, () => {
      reconcile('oauth-connections-changed');
    }),
    eventBus.subscribe(EVENT.REALTIME_RESYNC, () => {
      reconcile('realtime-resync');
    }),
  ];
}

function clearProjectionInvalidation(): void {
  runtimeUnsubscribers.forEach((unsubscribe) => unsubscribe());
  runtimeUnsubscribers = [];
}

export const agentCapabilityRuntime: RuntimeDescriptor = {
  id: 'agent-capability',
  scope: 'session',
  install() {
    if (installed) return;
    installed = true;
    runtimeGeneration += 1;
    installReconcileTimer();
    installProjectionInvalidation();
  },
  teardown() {
    useAgentStore.setState({ profileDraftsByAgentId: {}, saveStateByAgentId: {} });
    if (!installed) {
      useAgentCapabilityStore.getState().reset();
      return;
    }
    runtimeGeneration += 1;
    clearReconcileTimer();
    clearCapabilitySessionWarmup();
    clearProjectionInvalidation();
    clearAuthorityStreams();
    fullLoadInFlight = null;
    useAgentCapabilityStore.getState().reset();
    useAgentConnectorStore.getState().reset();
    useMCPStore.getState().reset();
    installed = false;
  },
  async bootstrap(actorId) {
    if (!actorId) return;
    await requestFullCapabilityLoad('bootstrap');
  },
  async reconcile(reason: string) {
    await requestFullCapabilityLoad(reason);
  },
};
