import type { RuntimeDescriptor } from '../kernel/runtime';
import { isBrowserGatewayRuntime } from '../kernel/gateway';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import {
  api,
  type AgentCapabilitySessionList,
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
const BROWSER_CAPABILITY_REFRESH_WINDOW_MS = CAPABILITY_RECONCILE_INTERVAL_MS;
const BROWSER_CAPABILITY_READY_POLL_INTERVAL_MS = 250;
const BROWSER_CAPABILITY_READY_ATTEMPTS = 40;

let installed = false;
let runtimeGeneration = 0;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let runtimeUnsubscribers: Array<() => void> = [];
let browserCapabilitySessionRefresh: Promise<AgentCapabilitySessionList> | null = null;

type CapabilitySession = AgentCapabilitySessionList['sessions'][number];
type AgentCapabilityProjectionStore = Pick<
  AgentCapabilityState,
  'loadCatalog' | 'loadKnowledgeDescriptors' | 'loadAgent'
>;

interface BrowserCapabilitySessionLifecycle {
  close(): Promise<unknown>;
  open(): Promise<unknown>;
  list(): Promise<AgentCapabilitySessionList>;
}

interface BrowserCapabilityRefreshOptions {
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  shouldContinue?: () => boolean;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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

export function browserCapabilitySessionNeedsRefresh(
  sessions: readonly CapabilitySession[],
  nowMs = Date.now(),
): boolean {
  const activeSession = selectActiveCapabilitySession(sessions, true, nowMs);
  return !activeSession || (
    capabilitySessionExpiresAtMs(activeSession) - nowMs
    <= BROWSER_CAPABILITY_REFRESH_WINDOW_MS
  );
}

export async function ensureFreshBrowserCapabilitySession(
  capabilitySessions: AgentCapabilitySessionList,
  lifecycle: BrowserCapabilitySessionLifecycle,
  options: BrowserCapabilityRefreshOptions = {},
): Promise<AgentCapabilitySessionList> {
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const shouldContinue = options.shouldContinue ?? (() => true);
  if (!browserCapabilitySessionNeedsRefresh(capabilitySessions.sessions, now())) {
    return capabilitySessions;
  }

  await lifecycle.close();
  if (!shouldContinue()) return capabilitySessions;
  await lifecycle.open();

  let latest = capabilitySessions;
  for (let attempt = 0; attempt < BROWSER_CAPABILITY_READY_ATTEMPTS; attempt += 1) {
    if (!shouldContinue()) return latest;
    latest = await lifecycle.list();
    if (!browserCapabilitySessionNeedsRefresh(latest.sessions, now())) {
      return latest;
    }
    if (attempt + 1 < BROWSER_CAPABILITY_READY_ATTEMPTS) {
      await wait(BROWSER_CAPABILITY_READY_POLL_INTERVAL_MS);
    }
  }

  throw new Error('agent.browserCapabilitySessionUnavailable');
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

async function ensureRuntimeBrowserCapabilitySession(
  capabilitySessions: AgentCapabilitySessionList,
  generation: number,
  reason: string,
): Promise<AgentCapabilitySessionList> {
  if (
    !isBrowserGatewayRuntime()
    || !browserCapabilitySessionNeedsRefresh(capabilitySessions.sessions)
  ) {
    return capabilitySessions;
  }
  if (browserCapabilitySessionRefresh !== null) {
    return browserCapabilitySessionRefresh;
  }

  log.info('agentCapabilityRuntime', 'refreshing browser capability session', { reason });
  browserCapabilitySessionRefresh = ensureFreshBrowserCapabilitySession(
    capabilitySessions,
    {
      close: closeBrowserCapabilitySession,
      open: openBrowserCapabilitySession,
      list: api.listAgentCapabilitySessions,
    },
    {
      shouldContinue: () => installed && generation === runtimeGeneration,
    },
  );
  try {
    return await browserCapabilitySessionRefresh;
  } finally {
    browserCapabilitySessionRefresh = null;
  }
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
  const capabilitySessions = await ensureRuntimeBrowserCapabilitySession(
    listedCapabilitySessions,
    generation,
    reason,
  );
  if (!installed || generation !== runtimeGeneration) return;
  const browserShell = isBrowserGatewayRuntime();
  const activeSession = selectActiveCapabilitySession(
    capabilitySessions.sessions,
    browserShell,
  );

  const authorityStore = useAgentCapabilityStore.getState();
  const agentIds = Array.from(new Set(
    useAgentStore.getState().agents
      .map((agent) => agent.id.trim())
      .filter(Boolean),
  ));
  await reconcileAgentCapabilityProjection(
    authorityStore,
    agentIds,
    activeSession?.session_id,
  );
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
    useAgentCapabilityStore.getState().reset();
    useAgentConnectorStore.getState().reset();
    useMCPStore.getState().reset();
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
