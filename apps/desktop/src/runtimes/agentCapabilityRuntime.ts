import type { RuntimeDescriptor } from '../kernel/runtime';
import { isBrowserGatewayRuntime } from '../kernel/gateway';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import {
  api,
  streamAgentAuthorityEvents,
  type AgentCapabilitySessionList,
  type AgentAuthorityStreamPayload,
} from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
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

function capabilitySessionExpiresAtMs(session: CapabilitySession): number {
  if (!session.expires_at) return 0;
  return (
    session.expires_at.seconds * 1_000
    + Math.floor(session.expires_at.nanos / 1_000_000)
  );
}

export function selectActiveCapabilitySession(
  sessions: readonly CapabilitySession[],
  browserShell: boolean,
  nowMs = Date.now(),
): CapabilitySession | undefined {
  const active = sessions.filter(
    (session) =>
      Boolean(session.session_id)
      && capabilitySessionExpiresAtMs(session) > nowMs,
  );

  const preferredPlatform = browserShell
    ? 'CLIENT_PLATFORM_BROWSER'
    : 'CLIENT_PLATFORM_DESKTOP';
  return active
    .filter((session) => session.platform === preferredPlatform)
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
): Promise<void> {
  await Promise.all([
    authorityStore.loadCatalog(),
    authorityStore.loadKnowledgeDescriptors(),
    ...agentIds.map((agentId) => authorityStore.loadAgent(agentId, {
      clientCapabilitySessionId,
    })),
  ]);
}

async function openBrowserCapabilitySession(): Promise<void> {
  if (!isBrowserGatewayRuntime()) return;
  await api.openBrowserCapabilitySession();
}

export async function closeBrowserCapabilitySession(): Promise<void> {
  if (!isBrowserGatewayRuntime()) return;
  await api.closeBrowserCapabilitySession();
}

async function loadAgentCapabilities(reason: string): Promise<void> {
  if (!installed) return;
  const generation = runtimeGeneration;
  log.info('agentCapabilityRuntime', 'loading agent capability projections', { reason });
  const [capabilitySessions] = await Promise.all([
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
    capabilitySessions.sessions,
    isBrowserGatewayRuntime(),
  );

  const authorityStore = useAgentCapabilityStore.getState();
  const agentIds = Array.from(new Set(
    useAgentStore.getState().agents
      .map((agent) => agent.id.trim())
      .filter(Boolean),
  ));
  syncAuthorityStreams(agentIds);
  await reconcileAgentCapabilityProjection(
    authorityStore,
    agentIds,
    activeSession?.session_id,
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
  if (isBrowserGatewayRuntime()) return;
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
        void reconcileAgentCapabilityProjection(
          useAgentCapabilityStore.getState(),
          [agentId],
        ).catch((error) => {
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
    if (!installed) {
      useAgentCapabilityStore.getState().reset();
      return;
    }
    runtimeGeneration += 1;
    clearReconcileTimer();
    clearProjectionInvalidation();
    clearAuthorityStreams();
    useAgentCapabilityStore.getState().reset();
    void closeBrowserCapabilitySession().catch((error) => {
      log.warn('agentCapabilityRuntime', 'browser capability session close failed', {
        error: String(error),
      });
    });
    installed = false;
  },
  async bootstrap(actorId) {
    if (!actorId) return;
    await openBrowserCapabilitySession();
    await loadAgentCapabilities('bootstrap');
  },
  async reconcile(reason: string) {
    await loadAgentCapabilities(reason);
  },
};
