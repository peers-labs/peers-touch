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
const AGENT_PROJECTION_CONCURRENCY = 2;
const MAX_AUTHORITY_STREAMS = 4;

let installed = false;
let runtimeGeneration = 0;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let runtimeUnsubscribers: Array<() => void> = [];
const authorityStreams = new Map<string, AbortController>();

type CapabilitySession = AgentCapabilitySessionList['sessions'][number];
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

export function selectActiveCapabilitySession(
  sessions: readonly CapabilitySession[],
  nowMs = Date.now(),
): CapabilitySession | undefined {
  const active = sessions.filter(
    (session) =>
      Boolean(session.session_id)
      && capabilitySessionExpiresAtMs(session) > nowMs,
  );

  return active
    .filter((session) => session.platform === 'CLIENT_PLATFORM_DESKTOP')
    .sort((left, right) => {
      const expiryDelta =
        capabilitySessionExpiresAtMs(right) - capabilitySessionExpiresAtMs(left);
      if (expiryDelta !== 0) return expiryDelta;
      return right.lease_revision - left.lease_revision;
    })[0];
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

async function loadAgentCapabilities(reason: string): Promise<void> {
  if (!installed) return;
  const generation = runtimeGeneration;
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
  const activeSession = selectActiveCapabilitySession(
    listedCapabilitySessions.sessions,
  );

  const authorityStore = useAgentCapabilityStore.getState();
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
        void loadAgentCapabilities('authority-invalidated').catch((error) => {
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
    void loadAgentCapabilities('periodic').catch((error) => {
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
    void loadAgentCapabilities(reason).catch((error) => {
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
    clearProjectionInvalidation();
    clearAuthorityStreams();
    useAgentCapabilityStore.getState().reset();
    useAgentConnectorStore.getState().reset();
    useMCPStore.getState().reset();
    installed = false;
  },
  async bootstrap(actorId) {
    if (!actorId) return;
    await loadAgentCapabilities('bootstrap');
  },
  async reconcile(reason: string) {
    await loadAgentCapabilities(reason);
  },
};
