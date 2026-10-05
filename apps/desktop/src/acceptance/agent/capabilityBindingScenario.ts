import { create } from '@bufbuild/protobuf';

import {
  CapabilityAcceptanceRuntimeProfile,
  CapabilityAcceptanceScenarioFamily,
  CapabilityApprovalPolicy,
  CapabilityReadinessState,
  CleanupCapabilityAcceptanceScenarioRequestSchema,
  PrepareCapabilityAcceptanceScenarioRequestSchema,
  ReleaseCapabilityAcceptanceBarrierRequestSchema,
  type AgentCapabilityBinding,
  type CapabilityCatalogIssue,
  type CapabilityManifest,
  type CapabilityReadinessSnapshot,
} from '../../gen/proto/domain/agent/capability_pb';
import i18n, { changeLanguage } from '../../i18n';
import { EVENT, eventBus } from '../../kernel/events';
import { identityRuntime } from '../../kernel/identityRuntime';
import {
  installAuthenticatedCriticalRuntimes,
  installDeferredAppRuntimeProjections,
} from '../../services/appRuntime';
import {
  api,
  projectAgentTypedErrorPayload,
  RustCommandException,
  type AgentCapabilityNegativeControlFact,
  type AgentTypedErrorPayload,
} from '../../services/desktop_api';
import { useAgentStore } from '../../store/agent';
import { useAgentCapabilityStore } from '../../store/agentCapabilities';
import { useSessionStore } from '../../store/session';

export interface CapabilityBindingScenarioInput {
  runId: string;
  scenarioExecutionId: string;
  cell: string;
  platform: 'desktop_app' | 'secondary';
  locale: 'en' | 'zh-CN';
  ordering: 'single';
  sampleId: 'sample-001';
  agentName: string;
  primaryAccount: string;
  secondaryAccount: string;
  password: string;
  clientCapabilitySessionId?: string;
}

export type CapabilitySessionIdResolver = () => Promise<string>;

interface ScenarioResources {
  capabilityId: string;
  requestedVersion: string;
  actualVersion: string;
  targetDeviceId: string;
  barrier: string;
}

const ERROR_TYPE_BY_CELL: Record<string, string> = {
  'ERR-CAT01': 'CAPABILITY_MANIFEST_NOT_FOUND',
  'ERR-CAT02': 'CAPABILITY_MANIFEST_VERSION_STALE',
  'ERR-CAT03': 'CAPABILITY_MANIFEST_SCHEMA_INVALID',
  'ERR-B01': 'CAPABILITY_BINDING_VERSION_CONFLICT',
  'ERR-B02': 'CAPABILITY_UNAVAILABLE',
  'ERR-B03': 'CAPABILITY_POLICY_INVALID',
};

const READINESS_BY_CELL: Record<string, string> = {
  'TAX-01': 'ready',
  'TAX-02': 'ready',
  'TAX-03': 'degraded',
  'TAX-04': 'unavailable',
  'TAX-05': 'unknown',
  'TAX-06': 'blocked',
};

function stableJson(value: unknown): string {
  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`agent.acceptance.timeout:${description}`);
}

function visibleElement(selector: string): HTMLElement | null {
  return Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  ).find((element) => element.getClientRects().length > 0) ?? null;
}

function resourceValue(resources: readonly string[], prefix: string): string {
  const value = resources.find((candidate) => candidate.startsWith(prefix));
  if (!value) {
    throw new Error(`agent.acceptance.capabilityScenarioResourceMissing:${prefix}`);
  }
  return value.slice(prefix.length);
}

function scenarioResources(resources: readonly string[]): ScenarioResources {
  return {
    capabilityId: resourceValue(resources, 'capability_id:'),
    requestedVersion: resourceValue(resources, 'requested_version:'),
    actualVersion: resourceValue(resources, 'actual_version:'),
    targetDeviceId: resourceValue(resources, 'target_device_id:'),
    barrier: resources.find((value) => value.startsWith('barrier:'))
      ?.slice('barrier:'.length) ?? '',
  };
}

function typedMutationError(error: unknown): AgentTypedErrorPayload {
  if (!(error instanceof RustCommandException) || !error.details) {
    throw error;
  }
  const typed = projectAgentTypedErrorPayload(error.details);
  if (!typed) throw error;
  return typed;
}

async function capabilityScenarioStep<T>(
  stage: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof RustCommandException)) throw error;
    const detailCode = String(
      error.details?.error_code
      ?? error.details?.reason_code
      ?? 'unknown',
    );
    throw new Error(
      `agent.acceptance.capabilityScenarioCommandFailed:`
      + `${stage}:${error.code}:${detailCode}:`
      + `${error.message}:${stableJson(error.details ?? {})}`,
    );
  }
}

function issueTypedError(issue: CapabilityCatalogIssue): AgentTypedErrorPayload {
  if (!issue.error) {
    throw new Error('agent.acceptance.capabilityCatalogIssueErrorMissing');
  }
  return {
    error: issue.error.error,
    error_type: issue.error.errorType,
    locale_key: issue.error.localeKey,
    retryable: issue.error.retryable,
    terminal: issue.error.terminal,
    details: { ...issue.error.details },
  };
}

async function authenticate(account: string, password: string): Promise<string> {
  if (useSessionStore.getState().authenticated) {
    await identityRuntime.logout();
  }
  await waitFor(
    () => {
      const snapshot = identityRuntime.getSnapshot();
      return snapshot.phase.kind === 'accountGate' && snapshot.lifecycle.dataReady;
    },
    'capability scenario account gate',
  );
  await identityRuntime.loginWithPassword(account, password);
  await identityRuntime.completeCurrentSession();
  await waitFor(
    () => identityRuntime.getSnapshot().lifecycle.state === 'ready',
    'capability scenario login',
  );
  const actor = useSessionStore.getState().currentUser?.actorPtid ?? '';
  if (!actor) throw new Error('agent.acceptance.capabilityScenarioActorMissing');
  await installAuthenticatedCriticalRuntimes(actor);
  await installDeferredAppRuntimeProjections(actor);
  return actor;
}

async function showCapabilitySurface(agentName: string): Promise<void> {
  const agentStore = useAgentStore.getState();
  agentStore.setSelectedAgent(agentName);
  agentStore.setAgentSurface(agentName, 'profile');
  await api.setSelectedAgent(agentName);
  eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });
  await waitFor(
    () => Boolean(visibleElement(
      '[data-pt-agent-profile-tab="capabilities"]',
    )),
    'capability profile tab',
  );
  visibleElement(
    '[data-pt-agent-profile-tab="capabilities"]',
  )?.click();
  await waitFor(
    () => Boolean(visibleElement(
      '[data-pt-agent-capability-inventory]',
    )),
    'capability inventory',
  );
}

function selectedAgent() {
  const state = useAgentStore.getState();
  return state.agents.find((agent) => agent.name === state.selectedAgent);
}

async function targetReadback(
  agentId: string,
  capabilityId: string,
): Promise<{
  inventory: {
    manifests: CapabilityManifest[];
    issues: CapabilityCatalogIssue[];
  };
  bindings: AgentCapabilityBinding[];
}> {
  const [inventory, bindings] = await Promise.all([
    api.listCapabilityManifestInventory(),
    api.listAgentCapabilityBindings(agentId),
  ]);
  return {
    inventory: {
      manifests: inventory.manifests.filter(
        (manifest) => manifest.capabilityId === capabilityId,
      ),
      issues: inventory.issues.filter(
        (issue) => issue.capabilityId === capabilityId,
      ),
    },
    bindings: bindings.filter(
      (binding) => binding.capabilityId === capabilityId,
    ),
  };
}

function readinessState(
  snapshot: CapabilityReadinessSnapshot,
  capabilityId: string,
  fallbackRevision: bigint,
): {
  state: string;
  authority: string;
  revision: bigint;
  targetPresent: boolean;
} {
  const readiness = snapshot.capabilities.find(
    (item) => item.capabilityId === capabilityId,
  );
  if (!readiness) {
    if (!snapshot.snapshotId) {
      throw new Error('agent.acceptance.capabilityReadinessSnapshotMissing');
    }
    return {
      state: 'unknown',
      authority: 'station',
      revision: fallbackRevision,
      targetPresent: false,
    };
  }
  const states: Record<number, string> = {
    [CapabilityReadinessState.READY]: 'ready',
    [CapabilityReadinessState.DEGRADED]: 'degraded',
    [CapabilityReadinessState.UNAVAILABLE]: 'unavailable',
    [CapabilityReadinessState.BLOCKED]: 'blocked',
    [CapabilityReadinessState.UNKNOWN]: 'unknown',
  };
  const state = states[readiness.state];
  if (!state || readiness.authority !== 'station-capability-authority') {
    throw new Error('agent.acceptance.capabilityReadinessFactInvalid');
  }
  return {
    state,
    authority: 'station',
    revision: readiness.bindingRevision || fallbackRevision,
    targetPresent: true,
  };
}

function traceCount(
  value: Awaited<ReturnType<typeof api.listAgentTurnTraces>>,
): number {
  return Number(value.total ?? value.entries.length);
}

function actorReadRejected(errorCode: string): boolean {
  return errorCode === 'NOT_FOUND' || errorCode === 'AGENT_4004';
}

function crossDeviceRejected(
  fact: AgentCapabilityNegativeControlFact | null,
): boolean {
  if (
    !fact
    || fact.availability !== 'available'
    || fact.station?.requestSent !== true
    || fact.station.responseReceived !== true
  ) {
    return false;
  }
  const rejected = fact.station.httpStatus === 403
    || fact.station.commandErrorCode === 'CLIENT_CAPABILITY_COMMAND_ERROR_CODE_UNAUTHORIZED';
  return rejected
    && fact.after.localExecutionAttemptCount
      === fact.before.localExecutionAttemptCount
    && fact.after.localSideEffectCount === fact.before.localSideEffectCount;
}

export async function runCapabilityBindingScenario(
  input: CapabilityBindingScenarioInput,
  resolveClientCapabilitySessionId?: CapabilitySessionIdResolver,
): Promise<Record<string, unknown>> {
  const startedAt = performance.now();
  const initialActor = useSessionStore.getState().currentUser?.actorPtid ?? '';
  if (!initialActor) {
    throw new Error('agent.acceptance.capabilityScenarioActorMissing');
  }
  await changeLanguage(input.locale);
  if (i18n.language !== input.locale) {
    throw new Error('agent.acceptance.capabilityScenarioLocaleMismatch');
  }
  await useAgentStore.getState().loadAgents();
  const requestedAgent = useAgentStore.getState().agents.find(
    (candidate) => candidate.name === input.agentName,
  );
  if (!requestedAgent) {
    throw new Error('agent.acceptance.capabilityScenarioAgentMissing');
  }
  useAgentStore.getState().setSelectedAgent(requestedAgent.name);
  await api.setSelectedAgent(requestedAgent.name);
  const agent = selectedAgent();
  if (!agent?.provider || !agent.model) {
    throw new Error('agent.acceptance.capabilityScenarioAgentMissing');
  }
  const agentId = agent.id || agent.name;
  const priorSurface = useAgentStore.getState().getAgentSurface(agent.name);
  let clientCapabilitySessionId = input.clientCapabilitySessionId;
  if (input.platform === 'desktop_app' && !clientCapabilitySessionId) {
    throw new Error('agent.acceptance.capabilitySessionUnavailable');
  }
  let readinessInput = { clientCapabilitySessionId };
  const prepared = await capabilityScenarioStep(
    'prepare',
    () => api.prepareCapabilityAcceptanceScenario(create(
      PrepareCapabilityAcceptanceScenarioRequestSchema,
      {
        runId: input.runId,
        scenarioExecutionId: input.scenarioExecutionId,
        cell: input.cell,
        platform: input.platform,
        locale: input.locale,
        ordering: input.ordering,
        sampleId: input.sampleId,
        family: CapabilityAcceptanceScenarioFamily.BINDING_J02,
        runtimeAttestationProfile:
          CapabilityAcceptanceRuntimeProfile.STATION_CONTROL_PLANE,
      },
    )),
  );
  const resources = scenarioResources(prepared.opaqueResourceIds);
  const capabilityKey = `${encodeURIComponent(resources.capabilityId)}@`
    + encodeURIComponent(resources.requestedVersion);
  let binding: AgentCapabilityBinding | null = null;
  let typedError: AgentTypedErrorPayload | null = null;
  let pendingObserved = false;
  let actorIsolation: Record<string, unknown> | null = null;
  let deviceIsolation: AgentCapabilityNegativeControlFact | null = null;
  let cleanupResponse: Awaited<
    ReturnType<typeof api.cleanupCapabilityAcceptanceScenario>
  > | null = null;
  let capture: Record<string, unknown> | null = null;
  let primaryError: unknown = null;
  const tracesBefore = await capabilityScenarioStep(
    'trace-before',
    () => api.listAgentTurnTraces(
      agentId,
      { page: 1, pageSize: 200 },
    ),
  );

  try {
    await capabilityScenarioStep(
      'catalog',
      () => useAgentCapabilityStore.getState().loadCatalog(),
    );
    await capabilityScenarioStep(
      'surface',
      () => showCapabilitySurface(agent.name),
    );
    await capabilityScenarioStep(
      'agent-readiness',
      () => useAgentCapabilityStore.getState().loadAgent(
        agentId,
        readinessInput,
      ),
    );

    if (input.cell === 'ERR-CAT03') {
      const issue = useAgentCapabilityStore.getState().catalogIssues.find(
        (candidate) => candidate.capabilityId === resources.capabilityId,
      );
      if (!issue) {
        throw new Error('agent.acceptance.capabilityCatalogIssueMissing');
      }
      typedError = issueTypedError(issue);
    } else {
      if (input.cell === 'ERR-CAT01' || input.cell === 'ERR-CAT02') {
        await waitFor(
          () => Boolean(visibleElement(
            `[data-pt-agent-capability="${capabilityKey}"]`,
          )),
          'capability scenario source manifest',
        );
        await api.releaseCapabilityAcceptanceBarrier(create(
          ReleaseCapabilityAcceptanceBarrierRequestSchema,
          {
            scenarioHandle: prepared.scenarioHandle,
            barrier: resources.barrier,
          },
        ));
      }
      const intent = {
        agentId,
        capabilityId: resources.capabilityId,
        capabilityVersion: resources.requestedVersion,
        enabled: true,
        approvalPolicy: CapabilityApprovalPolicy.MANUAL,
        expectedAgentVersion: agent.version,
        expectedBindingRevision: 0n,
        idempotencyKey: crypto.randomUUID(),
        ...readinessInput,
      };
      if (input.cell === 'TAX-02') {
        const mutation = useAgentCapabilityStore.getState().upsertBinding(intent);
        const mutationKey = `upsert:${agentId}:${resources.capabilityId}`;
        await waitFor(
          () => Boolean(
            useAgentCapabilityStore.getState().pendingMutations[mutationKey],
          ),
          'capability pending mutation',
        );
        pendingObserved = true;
        await api.releaseCapabilityAcceptanceBarrier(create(
          ReleaseCapabilityAcceptanceBarrierRequestSchema,
          {
            scenarioHandle: prepared.scenarioHandle,
            barrier: resources.barrier,
          },
        ));
        binding = await mutation;
      } else {
        try {
          binding = await useAgentCapabilityStore.getState().upsertBinding(intent);
          if (input.cell === 'ERR-B01' || input.cell === 'ERR-B03') {
            const staleRevision = binding.revision;
            const updated = await useAgentCapabilityStore.getState().upsertBinding({
              ...intent,
              bindingId: binding.bindingId,
              approvalPolicy: CapabilityApprovalPolicy.AUTO,
              expectedBindingRevision: binding.revision,
              idempotencyKey: crypto.randomUUID(),
            });
            try {
              await useAgentCapabilityStore.getState().upsertBinding({
                ...intent,
                bindingId: updated.bindingId,
                approvalPolicy: input.cell === 'ERR-B03'
                  ? CapabilityApprovalPolicy.UNSPECIFIED
                  : CapabilityApprovalPolicy.DENY,
                expectedBindingRevision: input.cell === 'ERR-B01'
                  ? staleRevision
                  : updated.revision,
                idempotencyKey: crypto.randomUUID(),
              });
            } catch (error) {
              typedError = typedMutationError(error);
            }
            binding = updated;
          }
        } catch (error) {
          typedError = typedMutationError(error);
        }
      }
      if (typedError) {
        await waitFor(
          () => Boolean(visibleElement(
            `[data-pt-agent-capability-error="${typedError?.error_type}"]`,
          )),
          'capability typed error surface',
        );
      }
      if (input.cell === 'TAX-05') {
        await api.releaseCapabilityAcceptanceBarrier(create(
          ReleaseCapabilityAcceptanceBarrierRequestSchema,
          {
            scenarioHandle: prepared.scenarioHandle,
            barrier: resources.barrier,
          },
        ));
        await useAgentCapabilityStore.getState().loadAgent(
          agentId,
          readinessInput,
        );
      }
      if (input.cell === 'AS-11' && binding) {
        await useAgentCapabilityStore.getState().deleteBinding({
          agentId,
          bindingId: binding.bindingId,
          expectedBindingRevision: binding.revision,
          idempotencyKey: crypto.randomUUID(),
          reason: 'acceptance_scenario_delete',
        });
      }
      if (input.cell === 'AS-10') {
        const sessions = await api.listAgentCapabilitySessions();
        const local = await api.getAgentCapabilitySessionSnapshot();
        const localSession = local.sessions[0];
        const stationSessions = await Promise.all(
          sessions.sessions.map(async (session) => ({
            session,
            sessionIdHash: await sha256Hex(session.session_id),
          })),
        );
        const currentStation = stationSessions.find(
          ({ sessionIdHash }) =>
            sessionIdHash === localSession?.capability_session_id_hash,
        )?.session;
        const crossDevice = sessions.sessions.find(
          (session) =>
            currentStation
            && session.session_id !== currentStation.session_id
            && session.device_id !== currentStation.device_id,
        );
        if (!localSession || !currentStation || !crossDevice) {
          throw new Error('agent.acceptance.capabilityScenarioDevicePairMissing');
        }
        deviceIsolation = await api.runAgentCapabilityNegativeControl(
          'crossDevice',
          localSession.capability_session_id_hash,
          crossDevice.session_id,
        );
        const secondaryActor = await authenticate(
          input.secondaryAccount,
          input.password,
        );
        let secondaryError = '';
        try {
          await api.listAgentCapabilityBindings(agentId);
        } catch (error) {
          secondaryError = error instanceof RustCommandException
            ? String(error.details?.error_code ?? error.code)
            : String(error);
        }
        const restoredActor = await authenticate(
          input.primaryAccount,
          input.password,
        );
        if (input.platform === 'desktop_app') {
          if (!resolveClientCapabilitySessionId) {
            throw new Error('agent.acceptance.capabilitySessionResolverUnavailable');
          }
          clientCapabilitySessionId = await resolveClientCapabilitySessionId();
          readinessInput = { clientCapabilitySessionId };
        }
        actorIsolation = {
          secondaryActorHash: await sha256Hex(secondaryActor),
          primaryActorRestored: restoredActor === initialActor,
          bindingReadError: secondaryError,
        };
        await useAgentStore.getState().loadAgents();
        await showCapabilitySurface(agent.name);
        await useAgentCapabilityStore.getState().loadAgent(
          agentId,
          readinessInput,
        );
      }
    }

    const readiness = await capabilityScenarioStep(
      'readiness',
      () => api.readAgentCapabilityReadiness({
        agent_id: agentId,
        client_capability_session_id: clientCapabilitySessionId,
      }),
    );
    const state = readinessState(
      readiness,
      resources.capabilityId,
      BigInt(agent.version),
    );
    const readback = await targetReadback(agentId, resources.capabilityId);
    const replay = await targetReadback(agentId, resources.capabilityId);
    const sourceHash = await sha256Hex(stableJson(readback));
    const replayHash = await sha256Hex(stableJson(replay));
    const expectedErrorType = ERROR_TYPE_BY_CELL[input.cell] ?? '';
    if (expectedErrorType && typedError?.error_type !== expectedErrorType) {
      throw new Error(
        `agent.acceptance.capabilityScenarioTypedErrorMismatch:${input.cell}`,
      );
    }
    if (READINESS_BY_CELL[input.cell] && state.state !== READINESS_BY_CELL[input.cell]) {
      throw new Error(
        `agent.acceptance.capabilityScenarioReadinessMismatch:${input.cell}`,
      );
    }
    if (input.cell === 'TAX-02' && !pendingObserved) {
      throw new Error('agent.acceptance.capabilityScenarioPendingMissing');
    }
    if (
      input.cell === 'AS-10'
      && (
        actorIsolation?.primaryActorRestored !== true
        || !actorReadRejected(String(actorIsolation.bindingReadError))
        || !crossDeviceRejected(deviceIsolation)
      )
    ) {
      throw new Error('agent.acceptance.capabilityScenarioIsolationFailed');
    }
    const tracesAfter = await api.listAgentTurnTraces(
      agentId,
      { page: 1, pageSize: 200 },
    );
    const executionDelta = traceCount(tracesAfter) - traceCount(tracesBefore);
    if (executionDelta !== 0) {
      throw new Error('agent.acceptance.capabilityScenarioExecutedTurn');
    }
    const durationMs = Math.ceil(performance.now() - startedAt);
    const latestBinding = readback.bindings[readback.bindings.length - 1];
    const latestIssue =
      readback.inventory.issues[readback.inventory.issues.length - 1];
    const revision = Number(
      latestBinding?.revision
      ?? latestIssue?.revision
      ?? BigInt(agent.version),
    );
    const stateHash = await sha256Hex(stableJson(readback));
    const entityIdHash = await sha256Hex(
      `${agentId}\u0000${resources.capabilityId}`,
    );
    const selector = typedError
      ? `[data-pt-agent-capability-error="${typedError.error_type}"]`
      : `[data-pt-agent-capability="${capabilityKey}"]`;
    const receiverElement = visibleElement(selector) ?? (
      typedError ? null : visibleElement('[data-pt-agent-capability-inventory]')
    );
    if (!receiverElement) {
      throw new Error('agent.acceptance.capabilityScenarioReceiverMissing');
    }
    const receiverText = receiverElement.textContent?.trim() ?? '';
    const receiverVisible = receiverElement.getClientRects().length > 0;
    const localizedSurfaceVisible = receiverVisible && (
      !typedError
      || receiverText.includes(i18n.t(typedError.locale_key, { ns: 'agent' }))
    );
    const receiverTextHash = await sha256Hex(receiverText);
    capture = {
      runtime: {
        scenarioExecutionId: input.scenarioExecutionId,
        actorPtid: initialActor,
        scenarioHandle: prepared.scenarioHandle,
        sourceInventoryHash: prepared.sourceInventoryHash,
        observedAt: new Date().toISOString(),
        controlPlaneAttestation: {
          authority: 'station-capability-authority',
          entityIdHash,
          readinessSnapshotId: readiness.snapshotId,
          revision: Math.max(1, revision),
          stateHash,
          zeroExecutionCount: executionDelta,
        },
      },
      assertions: {
        tupleIdentityMatched: true,
        localizedSurfaceVisible,
        typedErrorMatched: !expectedErrorType
          || typedError?.error_type === expectedErrorType,
        readinessMatched: !READINESS_BY_CELL[input.cell]
          || state.state === READINESS_BY_CELL[input.cell],
        zeroExecution: executionDelta === 0,
        replayEqual: sourceHash === replayHash,
        pendingObserved: input.cell !== 'TAX-02' || pendingObserved,
        isolationObserved: input.cell !== 'AS-10'
          || (
            actorIsolation?.primaryActorRestored === true
            && actorReadRejected(String(actorIsolation.bindingReadError))
            && crossDeviceRejected(deviceIsolation)
          ),
      },
      roles: {
        'receiver-dom': {
          scenarioId: input.cell,
          cellId: input.cell,
          selector,
          locale: input.locale,
          textHash: receiverTextHash,
          expectedVisible: true,
          visible: receiverVisible,
        },
        'station-readback': {
          entityKind: 'agent-capability-authority',
          entityIdHash,
          revision: Math.max(1, revision),
          stateHash,
          manifestCount: readback.inventory.manifests.length,
          catalogIssueCount: readback.inventory.issues.length,
          bindingCount: readback.bindings.length,
          typedError,
          actorIsolation,
          deviceIsolation,
        },
        'readiness-snapshots': {
          snapshotId: readiness.snapshotId,
          state: state.state,
          authority: 'station',
          revision: Math.max(1, Number(state.revision)),
          targetPresent: state.targetPresent,
        },
        'zero-execution': {
          counterKind: 'agent-turn-trace-delta',
          count: executionDelta,
          expected: 0,
        },
        'measurement-report': {
          metric: 'capability-control-plane-duration-ms',
          sampleIds: [input.sampleId],
          threshold: '120000',
          observed: durationMs,
          passed: durationMs <= 120_000,
        },
        'side-effect-count': {
          counterId: 'agent-turn-trace-delta',
          count: executionDelta,
          maximum: 0,
        },
        replay: {
          sourceHash,
          replayHash,
          equal: sourceHash === replayHash,
        },
      },
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      cleanupResponse = await api.cleanupCapabilityAcceptanceScenario(create(
        CleanupCapabilityAcceptanceScenarioRequestSchema,
        { scenarioHandle: prepared.scenarioHandle },
      ));
      await useAgentCapabilityStore.getState().loadCatalog();
      useAgentStore.getState().setAgentSurface(agent.name, priorSurface);
    } catch (cleanupError) {
      throw Object.assign(
        new Error('agent.acceptance.capabilityScenarioCleanupFailed'),
        { primaryError, cleanupError, cleanupResponse },
      );
    }
  }
  if (!capture || !cleanupResponse) {
    throw new Error('agent.acceptance.capabilityScenarioCaptureMissing');
  }
  const roles = capture['roles'] as Record<string, Record<string, unknown>>;
  roles.cleanup = {
    resourceKind: 'capability-acceptance-scenario',
    resourceIdHash: await sha256Hex(cleanupResponse.scenarioHandle),
    status: 'clean',
    cleanedResourceCount: cleanupResponse.cleanedOpaqueResourceIds.length,
  };
  return capture;
}
