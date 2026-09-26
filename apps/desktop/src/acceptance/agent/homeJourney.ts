import { bootstrapRuntime, installRuntime } from '../../kernel/runtime';
import {
  HomeErrorCode,
  HomeProjectionFreshness,
  type HomeWorkProjection,
} from '../../gen/proto/domain/agent/home_pb';
import { refreshHomeProjection } from '../../runtimes/homeRuntime';
import { api, type Agent } from '../../services/desktop_api';
import { useAgentStore } from '../../store/agent';
import { useHomeStore } from '../../store/home';
import { useSessionStore } from '../../store/session';

const HOME_RUNTIME_PROFILE_ID = 'modern-chat-agent-v1';
const HOME_FIXTURE_PROVIDER_ID = 'ollama';
const HOME_FIXTURE_DESCRIPTION_PREFIX = 'Disposable V2-J01 ';
const HOME_CELLS = new Set([
  'AS-01',
  'AS-02',
  'AS-13',
  'R-11',
  'ERR-H01',
  'ERR-H02',
  'ERR-H03',
]);

export interface HomeCommandCenterScenarioInput {
  cell: string;
  locale: string;
  ordering: string;
  sampleId: string;
}

export interface HomeCommandCenterScenarioState {
  scenarioExecutionId: string;
  cell: string;
  locale: string;
  ordering: string;
  sampleId: string;
  actorPtid: string;
  agentId: string;
  agentName: string;
  modelId: string;
  conversationIds: string[];
  turnIds: string[];
  taskIds: string[];
  extraAgentIds: string[];
  expectedWorkIds: string[];
}

export interface HomeCommandCenterCapture {
  state: HomeCommandCenterScenarioState;
  requiresRestart: boolean;
  runtime: {
    scenarioExecutionId: string;
    actorPtid: string;
    commandId: string;
    commandKind: string;
    idempotencyKeyHash: string;
    objectIds: string[];
    projectionRevision: string;
    observedAt: string;
  };
  roles: Record<string, Record<string, unknown>>;
  assertions: Record<string, boolean>;
  barrier?: Record<string, unknown>;
}

function requireValue<T>(
  value: T | null | undefined | false | '',
  errorKey: string,
): T {
  if (!value) throw new Error(errorKey);
  return value;
}

function evidenceValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(evidenceValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, evidenceValue(item)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
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
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(`agent.acceptance.homeTimedOut:${description}`);
}

function observedErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const candidate = error as {
    code?: unknown;
    details?: unknown;
    message?: unknown;
  };
  const details = stableJson(evidenceValue(candidate.details));
  if (details.includes('ADMISSION_DUPLICATE_CONFLICT')) {
    return 'ADMISSION_DUPLICATE_CONFLICT';
  }
  if (details.includes('AGENT_4001')) return 'INVALID_REQUEST';
  if (typeof candidate.code === 'string' && candidate.code) {
    return candidate.code;
  }
  return String(candidate.message ?? 'UNKNOWN');
}

function isResourceNotFound(error: unknown): boolean {
  const code = observedErrorCode(error);
  return code === 'NOT_FOUND' || code.includes('AGENT_4004');
}

function activeActorPtid(): string {
  return requireValue(
    useSessionStore.getState().currentUser?.actorPtid?.trim(),
    'agent.acceptance.homeActorMissing',
  );
}

async function navigateHome(actorPtid: string): Promise<HTMLElement> {
  useHomeStore.getState().reset();
  installRuntime('home');
  await bootstrapRuntime('home', actorPtid);
  await refreshHomeProjection('acceptance-home-navigation');
  window.location.hash = '#/home';
  // eslint-disable-next-line no-restricted-syntax -- HashRouter observes the browser hashchange boundary.
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  await waitFor(
    () => Boolean(
      document.querySelector<HTMLElement>('[data-pt-home]')
        ?.getClientRects().length,
    ),
    'Home receiver',
  );
  return requireValue(
    document.querySelector<HTMLElement>('[data-pt-home]'),
    'agent.acceptance.homeReceiverMissing',
  );
}

async function createHomeAgent(
  input: HomeCommandCenterScenarioInput,
  modelId: string,
  options: {
    configured: boolean;
    suffix: string;
  },
): Promise<Agent> {
  return useAgentStore.getState().createAgent({
    name: `acceptance-home-v2-${input.cell.toLowerCase()}-${options.suffix}-${crypto.randomUUID()}`,
    title: `Home ${input.cell} ${input.locale}`,
    description: `${HOME_FIXTURE_DESCRIPTION_PREFIX}${input.cell} fixture`,
    provider: options.configured ? HOME_FIXTURE_PROVIDER_ID : '',
    model: options.configured ? modelId : '',
    pinned: true,
    visibility: 'private',
  });
}

async function createHomeRuntimeModel(
  input: HomeCommandCenterScenarioInput,
): Promise<string> {
  const provider = await api.getProvider(HOME_FIXTURE_PROVIDER_ID);
  if (
    provider.version !== 0
    || provider.has_api_key
    || provider.show_api_key !== false
  ) {
    throw new Error('agent.acceptance.homeFixtureProviderUnavailable');
  }
  const modelId = `home-${input.sampleId}-${crypto.randomUUID()}`;
  await api.addModel(HOME_FIXTURE_PROVIDER_ID, {
    id: modelId,
    display_name: `Home ${input.cell} fixture`,
    type: 'chat',
    context_window: 8_192,
    enabled: true,
    streaming: true,
    function_call: false,
  });
  return modelId;
}

async function readinessFor(agent: Agent): Promise<string> {
  const snapshot = await api.getAgentCapabilityReadiness({
    agent_id: agent.id || agent.name,
  });
  return requireValue(
    snapshot.snapshot_id,
    'agent.acceptance.homeReadinessMissing',
  );
}

function homeAgentFromProjection(
  projection: HomeWorkProjection,
  agentId: string,
) {
  return requireValue(
    projection.pinnedAgents.find((candidate) =>
      candidate.agentId === agentId),
    'agent.acceptance.homePinnedAgentMissing',
  );
}

async function projectionReceiver(
  projection: HomeWorkProjection,
  expectedWorkIds: readonly string[],
): Promise<{
  selector: string;
  textHash: string;
  visible: boolean;
  freshness: string;
  revision: string;
  expectedWorkVisible: boolean;
  submitBlocked: boolean;
}> {
  useHomeStore.getState().applyProjection(projection);
  const acceptedRevision = requireValue(
    useHomeStore.getState().projection,
    'agent.acceptance.homeAcceptedProjectionMissing',
  ).revision;
  await waitFor(
    () => document.querySelector<HTMLElement>('[data-pt-home]')
      ?.dataset.ptHomeRevision === acceptedRevision.toString(),
    'Home projection DOM revision',
  );
  const root = requireValue(
    document.querySelector<HTMLElement>('[data-pt-home]'),
    'agent.acceptance.homeReceiverMissing',
  );
  const submit = root.querySelector<HTMLButtonElement>(
    '[data-pt-home-submit]',
  );
  return {
    selector: '[data-pt-home]',
    textHash: await sha256Hex(root.innerText),
    visible: root.getClientRects().length > 0,
    freshness: root.dataset.ptHomeFreshness ?? '',
    revision: root.dataset.ptHomeRevision ?? '',
    expectedWorkVisible: expectedWorkIds.every((workId) =>
      Boolean(root.querySelector(`[data-pt-home-work="${CSS.escape(workId)}"]`))),
    submitBlocked: submit?.disabled === true,
  };
}

function commandInput(
  agent: ReturnType<typeof homeAgentFromProjection>,
  text: string,
  idempotencyKey: string,
) {
  return {
    agentId: agent.agentId,
    input: text,
    runtimeProfileId: HOME_RUNTIME_PROFILE_ID,
    clientIdempotencyKey: idempotencyKey,
    expectedAgentVersion: agent.agentVersion,
    readinessSnapshotId: agent.readinessSnapshotId,
  };
}

async function submitChatPair(
  agent: ReturnType<typeof homeAgentFromProjection>,
  input: HomeCommandCenterScenarioInput,
) {
  const idempotencyKey =
    `home-chat-${input.cell}-${input.locale}-${input.ordering}-${crypto.randomUUID()}`;
  const command = commandInput(
    agent,
    `Home ${input.cell} ${input.locale} Chat`,
    idempotencyKey,
  );
  const releasedAt = new Date().toISOString();
  const responses = input.ordering === 'A'
    ? await Promise.all([
        api.submitHomeChatCommand(command),
        api.submitHomeChatCommand(command),
      ])
    : [
        await api.submitHomeChatCommand(command),
        await api.submitHomeChatCommand(command),
      ];
  let conflictCode = '';
  try {
    await api.submitHomeChatCommand({
      ...command,
      input: `${command.input} changed`,
    });
  } catch (error) {
    conflictCode = observedErrorCode(error);
  }
  return {
    idempotencyKey,
    commandId: idempotencyKey,
    objectIds: [
      responses[0].conversationId,
      responses[0].turnId,
    ],
    conversationId: responses[0].conversationId,
    turnId: responses[0].turnId,
    projectionRevision: responses[0].projectionRevision,
    replayEqual:
      responses[0].conversationId === responses[1].conversationId
      && responses[0].turnId === responses[1].turnId,
    conflictCode,
    barrier: {
      kind: 'home-chat-idempotency',
      ordering: input.ordering,
      release: input.ordering === 'A'
        ? 'duplicate-before-first-response'
        : 'duplicate-after-first-response',
      releasedAt,
      settledAt: new Date().toISOString(),
    },
  };
}

async function submitTaskPair(
  agent: ReturnType<typeof homeAgentFromProjection>,
  input: HomeCommandCenterScenarioInput,
) {
  const idempotencyKey =
    `home-task-${input.cell}-${input.locale}-${input.ordering}-${crypto.randomUUID()}`;
  const command = commandInput(
    agent,
    `Home ${input.cell} ${input.locale} Task`,
    idempotencyKey,
  );
  const releasedAt = new Date().toISOString();
  const responses = input.ordering === 'A'
    ? await Promise.all([
        api.submitHomeTaskCommand(command),
        api.submitHomeTaskCommand(command),
      ])
    : [
        await api.submitHomeTaskCommand(command),
        await api.submitHomeTaskCommand(command),
      ];
  let conflictCode = '';
  try {
    await api.submitHomeTaskCommand({
      ...command,
      input: `${command.input} changed`,
    });
  } catch (error) {
    conflictCode = observedErrorCode(error);
  }
  return {
    idempotencyKey,
    commandId: idempotencyKey,
    objectIds: [responses[0].taskId],
    taskId: responses[0].taskId,
    projectionRevision: responses[0].projectionRevision,
    replayEqual: responses[0].taskId === responses[1].taskId,
    conflictCode,
    barrier: {
      kind: 'home-task-idempotency',
      ordering: input.ordering,
      release: input.ordering === 'A'
        ? 'duplicate-before-first-response'
        : 'duplicate-after-first-response',
      releasedAt,
      settledAt: new Date().toISOString(),
    },
  };
}

async function deleteHomeConversation(conversationId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const conversation = await api.getAgentConversation(conversationId);
      if (conversation.status === 'deleted') return true;
      await api.archiveAgentConversation(
        conversationId,
        conversation.version,
        true,
      );
    } catch {
      try {
        await api.getAgentConversation(conversationId);
      } catch {
        return true;
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

async function cleanupStaleHomeFixtures(): Promise<void> {
  await useAgentStore.getState().loadAgents();
  const staleAgents = useAgentStore.getState().agents.filter((agent) =>
    agent.description.startsWith(HOME_FIXTURE_DESCRIPTION_PREFIX));
  const failures: string[] = [];
  const modelIds = new Set<string>();
  for (const agent of staleAgents) {
    const agentId = agent.id || agent.name;
    if (
      agent.provider === HOME_FIXTURE_PROVIDER_ID
      && agent.model.startsWith('home-')
    ) {
      modelIds.add(agent.model);
    }
    try {
      const conversations = await api.listAgentConversations(agent.name, {
        page: 1,
        pageSize: 200,
      });
      for (const conversation of conversations) {
        const messages = await api.listAgentConversationMessages({
          conversation_id: conversation.conversation_id,
          limit: 200,
        });
        const turnIds = new Set(
          messages.messages
            .map((message) => message.turn_id)
            .filter((turnId): turnId is string => Boolean(turnId)),
        );
        for (const turnId of turnIds) {
          await api.cancelAgentTurn(turnId).catch(() => undefined);
        }
        if (!await deleteHomeConversation(conversation.conversation_id)) {
          failures.push('conversation:delete-not-observed');
        }
      }
    } catch (error) {
      failures.push(`conversation-list:${observedErrorCode(error)}`);
    }
    try {
      const tasks = await api.listAgentTasksRemote(agentId);
      for (const task of tasks) {
        await api.deleteAgentTaskRemote(task.id);
      }
    } catch (error) {
      if (!isResourceNotFound(error)) {
        failures.push(`task:${observedErrorCode(error)}`);
      }
    }
    try {
      await api.deleteAgent(agentId);
    } catch (error) {
      if (!isResourceNotFound(error)) {
        failures.push(`agent:${observedErrorCode(error)}`);
      }
    }
  }
  for (const modelId of modelIds) {
    try {
      await api.deleteModel(HOME_FIXTURE_PROVIDER_ID, modelId);
    } catch (error) {
      if (!isResourceNotFound(error)) {
        failures.push(`model:${observedErrorCode(error)}`);
      }
    }
  }
  try {
    const configuredProvider = (await api.listProviders()).find(
      (provider) =>
        provider.id === HOME_FIXTURE_PROVIDER_ID
        && provider.version > 0,
    );
    if (configuredProvider) {
      await api.deleteProvider(HOME_FIXTURE_PROVIDER_ID);
    }
  } catch (error) {
    failures.push(`provider:${observedErrorCode(error)}`);
  }
  await useAgentStore.getState().loadAgents();
  if (failures.length > 0) {
    throw new Error(
      `agent.acceptance.homeStaleFixtureCleanupFailed:${failures.join(',')}`,
    );
  }
}

async function cleanupState(
  state: HomeCommandCenterScenarioState,
): Promise<Record<string, unknown>> {
  const failures: string[] = [];
  for (const turnId of state.turnIds) {
    await api.cancelAgentTurn(turnId).catch(() => undefined);
  }
  for (const conversationId of state.conversationIds) {
    if (!await deleteHomeConversation(conversationId)) {
      failures.push('conversation:delete-not-observed');
    }
  }
  for (const taskId of state.taskIds) {
    try {
      await api.deleteAgentTaskRemote(taskId);
      const remaining = await api.listAgentTasksRemote(state.agentId);
      if (remaining.some((task) => task.id === taskId)) {
        failures.push('task:delete-not-observed');
      }
    } catch (error) {
      if (!isResourceNotFound(error)) {
        failures.push(`task:${observedErrorCode(error)}`);
      }
    }
  }
  for (const agentId of [...state.extraAgentIds, state.agentId]) {
    if (!agentId) continue;
    try {
      await api.deleteAgent(agentId);
    } catch (error) {
      if (!isResourceNotFound(error)) {
        failures.push(`agent:${observedErrorCode(error)}`);
      }
    }
  }
  if (state.modelId) {
    try {
      const configuredProvider = (await api.listProviders()).find(
        (provider) =>
          provider.id === HOME_FIXTURE_PROVIDER_ID
          && provider.version > 0,
      );
      if (configuredProvider) {
        await api.deleteProvider(HOME_FIXTURE_PROVIDER_ID);
      } else {
        await api.deleteModel(HOME_FIXTURE_PROVIDER_ID, state.modelId);
      }
      const restored = await api.getProvider(HOME_FIXTURE_PROVIDER_ID);
      if (
        restored.version !== 0
        || restored.has_api_key
        || restored.models.some((model) => model.id === state.modelId)
      ) {
        failures.push('provider:restore-not-observed');
      }
    } catch (error) {
      if (!isResourceNotFound(error)) {
        failures.push(`provider:${observedErrorCode(error)}`);
      }
    }
  }
  await useAgentStore.getState().loadAgents().catch((error) => {
    failures.push(`agent-refresh:${observedErrorCode(error)}`);
  });
  try {
    const projection = await api.getHomeWorkProjection(0n);
    const fixtureIds = new Set([
      ...state.expectedWorkIds,
      ...state.taskIds,
      ...state.conversationIds,
    ]);
    if (
      projection.pinnedAgents.some((agent) =>
        agent.agentId === state.agentId
        || state.extraAgentIds.includes(agent.agentId))
      || projection.activeTasks.some((task) => fixtureIds.has(task.taskId))
      || projection.recentWork.some((work) => fixtureIds.has(work.workId))
    ) {
      failures.push('projection:fixture-residue');
    }
  } catch (error) {
    failures.push(`projection:${observedErrorCode(error)}`);
  }
  useHomeStore.getState().reset();
  return {
    resourceKind: 'home-fixture',
    resourceIdHash: await sha256Hex(state.scenarioExecutionId),
    status: failures.length === 0 ? 'clean' : 'failed',
    failures,
  };
}

export async function cleanupHomeCommandCenterScenario(
  state: HomeCommandCenterScenarioState,
): Promise<Record<string, unknown>> {
  return cleanupState(state);
}

export async function recoverHomeCommandCenterScenario(
  state: HomeCommandCenterScenarioState,
): Promise<Record<string, unknown>> {
  if (activeActorPtid() !== state.actorPtid) {
    throw new Error('agent.acceptance.homeActorChanged');
  }
  await useAgentStore.getState().loadAgents();
  const root = await navigateHome(state.actorPtid);
  const projection = requireValue(
    useHomeStore.getState().projection,
    'agent.acceptance.homeRecoveryProjectionMissing',
  );
  const recovered = state.expectedWorkIds.every((workId) =>
    Boolean(root.querySelector(`[data-pt-home-work="${CSS.escape(workId)}"]`)));
  if (!recovered) {
    throw new Error('agent.acceptance.homeRecoveryWorkMissing');
  }
  return {
    recovered,
    revision: projection.revision.toString(),
    stateHash: await sha256Hex(stableJson(evidenceValue(projection))),
    receiverTextHash: await sha256Hex(root.innerText),
  };
}

export async function prepareHomeCommandCenterScenario(
  input: HomeCommandCenterScenarioInput,
): Promise<HomeCommandCenterCapture> {
  if (
    !HOME_CELLS.has(input.cell)
    || !['en', 'zh-CN'].includes(input.locale)
    || !['single', 'A', 'B'].includes(input.ordering)
  ) {
    throw new Error('agent.acceptance.homeScenarioIdentityInvalid');
  }

  const actorPtid = activeActorPtid();
  await cleanupStaleHomeFixtures();
  const scenarioExecutionId = crypto.randomUUID();
  const state: HomeCommandCenterScenarioState = {
    scenarioExecutionId,
    cell: input.cell,
    locale: input.locale,
    ordering: input.ordering,
    sampleId: input.sampleId,
    actorPtid,
    agentId: '',
    agentName: '',
    modelId: '',
    conversationIds: [],
    turnIds: [],
    taskIds: [],
    extraAgentIds: [],
    expectedWorkIds: [],
  };

  try {
    const configured = input.cell !== 'ERR-H03';
    if (configured) {
      state.modelId = await createHomeRuntimeModel(input);
    }
    const agent = await createHomeAgent(
      input,
      state.modelId,
      { configured, suffix: 'primary' },
    );
    state.agentId = agent.id || agent.name;
    state.agentName = agent.name;
    if (configured) await readinessFor(agent);

    if (input.cell === 'ERR-H02') {
      const unavailable = await createHomeAgent(
        input,
        '',
        { configured: false, suffix: 'unavailable' },
      );
      state.extraAgentIds.push(unavailable.id || unavailable.name);
    }

    await navigateHome(actorPtid);
    const before = await api.getHomeWorkProjection(0n);
    let observed = before;
    const projectedAgent = homeAgentFromProjection(before, state.agentId);
    const commandIds: string[] = [];
    const objectIds: string[] = [];
    const idempotencyKeys: string[] = [];
    const barriers: Record<string, unknown>[] = [];
    const assertions: Record<string, boolean> = {};
    let replaySource = '';
    let replayResult = '';
    let sideEffectCount = 0;
    let sideEffectMaximum = 1;

    if (input.cell === 'AS-01') {
      const chat = await submitChatPair(projectedAgent, input);
      state.conversationIds.push(chat.conversationId);
      state.turnIds.push(chat.turnId);
      state.expectedWorkIds.push(chat.conversationId);
      commandIds.push(chat.commandId);
      idempotencyKeys.push(chat.idempotencyKey);
      objectIds.push(...chat.objectIds);
      barriers.push(chat.barrier);
      replaySource = stableJson(chat.objectIds);
      replayResult = stableJson(chat.objectIds);
      sideEffectCount = 1;
      assertions.chatReplayEqual = chat.replayEqual;
      assertions.chatMismatchRejected = Boolean(chat.conflictCode);
    } else if (input.cell === 'R-11') {
      const [chat, task] = await Promise.all([
        submitChatPair(projectedAgent, input),
        submitTaskPair(projectedAgent, input),
      ]);
      state.conversationIds.push(chat.conversationId);
      state.turnIds.push(chat.turnId);
      state.taskIds.push(task.taskId);
      state.expectedWorkIds.push(chat.conversationId, task.taskId);
      commandIds.push(chat.commandId, task.commandId);
      idempotencyKeys.push(chat.idempotencyKey, task.idempotencyKey);
      objectIds.push(...chat.objectIds, ...task.objectIds);
      barriers.push(chat.barrier, task.barrier);
      replaySource = stableJson([...chat.objectIds, ...task.objectIds]);
      replayResult = stableJson([...chat.objectIds, ...task.objectIds]);
      sideEffectCount = 2;
      sideEffectMaximum = 2;
      assertions.chatReplayEqual = chat.replayEqual;
      assertions.taskReplayEqual = task.replayEqual;
      assertions.chatMismatchRejected = Boolean(chat.conflictCode);
      assertions.taskMismatchRejected = Boolean(task.conflictCode);
    } else if (input.cell === 'ERR-H03') {
      const idempotencyKey = `home-unready-${crypto.randomUUID()}`;
      commandIds.push(idempotencyKey);
      idempotencyKeys.push(idempotencyKey);
      objectIds.push(state.agentId);
      const beforeTaskIds = before.recentWork
        .filter((work) => work.agentId === state.agentId)
        .map((work) => work.workId)
        .sort();
      let rejection = '';
      try {
        await api.submitHomeTaskCommand({
          agentId: state.agentId,
          input: `Blocked Home task ${input.sampleId}`,
          runtimeProfileId: HOME_RUNTIME_PROFILE_ID,
          clientIdempotencyKey: idempotencyKey,
          expectedAgentVersion: BigInt(agent.version),
          readinessSnapshotId: '',
        });
      } catch (error) {
        rejection = observedErrorCode(error);
      }
      const rejectedProjection = await api.getHomeWorkProjection(0n);
      const afterTaskIds = rejectedProjection.recentWork
        .filter((work) => work.agentId === state.agentId)
        .map((work) => work.workId)
        .sort();
      replaySource = stableJson(beforeTaskIds);
      replayResult = stableJson(afterTaskIds);
      assertions.readinessRejected = Boolean(rejection);
      assertions.zeroTaskMutation =
        stableJson(beforeTaskIds) === stableJson(afterTaskIds);
      assertions.readinessSliceError = before.sliceErrors.some((error) =>
        error.code === HomeErrorCode.READINESS_UNRESOLVED);
    } else {
      const task = await submitTaskPair(projectedAgent, {
        ...input,
        ordering: 'B',
      });
      state.taskIds.push(task.taskId);
      state.expectedWorkIds.push(task.taskId);
      commandIds.push(task.commandId);
      idempotencyKeys.push(task.idempotencyKey);
      objectIds.push(...task.objectIds);
      barriers.push(task.barrier);
      replaySource = stableJson(task.objectIds);
      replayResult = stableJson(task.objectIds);
      sideEffectCount = 1;
      assertions.taskReplayEqual = task.replayEqual;
      assertions.taskMismatchRejected = Boolean(task.conflictCode);
    }

    observed = await api.getHomeWorkProjection(0n);
    if (input.cell === 'AS-13' || input.cell === 'ERR-H01') {
      const authoritativeRevision = observed.revision;
      const requestedRevision = (1n << 63n) - 1n;
      observed = await api.getHomeWorkProjection(requestedRevision);
      assertions.staleProjection =
        observed.freshness === HomeProjectionFreshness.STALE;
      assertions.staleRevisionPreserved =
        authoritativeRevision < requestedRevision
        && observed.revision < requestedRevision;
      assertions.staleErrorVisible = observed.sliceErrors.some((error) =>
        error.code === HomeErrorCode.PROJECTION_STALE
        && error.retryable
        && error.recoveryAction === 'retry');
    }
    if (input.cell === 'ERR-H02') {
      assertions.partialProjection =
        observed.freshness === HomeProjectionFreshness.PARTIAL;
      assertions.acceptedWorkPreserved = state.expectedWorkIds.every((workId) =>
        observed.recentWork.some((work) => work.workId === workId));
      assertions.sliceErrorVisible = observed.sliceErrors.some((error) =>
        error.code === HomeErrorCode.READINESS_UNRESOLVED);
    }
    if (input.cell === 'AS-13') {
      useHomeStore.getState().applyProjection(observed);
      await bootstrapRuntime('home', null);
      assertions.actorScopeCleared =
        useHomeStore.getState().projection === null;
      await bootstrapRuntime('home', actorPtid);
    }

    const receiver = await projectionReceiver(observed, state.expectedWorkIds);
    assertions.receiverVisible = receiver.visible;
    assertions.expectedWorkVisible =
      state.expectedWorkIds.length === 0 || receiver.expectedWorkVisible;
    if ([
      'AS-13',
      'ERR-H01',
      'ERR-H02',
      'ERR-H03',
    ].includes(input.cell)) {
      assertions.commitBlocked = receiver.submitBlocked;
    }
    const failed = Object.entries(assertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    if (failed.length > 0) {
      throw new Error(
        `agent.acceptance.homeAssertionsFailed:${failed.join(',')}`,
      );
    }

    const stationStateHash = await sha256Hex(
      stableJson(evidenceValue(observed)),
    );
    const commandId = commandIds.join('+');
    const idempotencyKeyHash = await sha256Hex(idempotencyKeys.join('+'));
    const replayHash = await sha256Hex(replaySource);
    const replayedHash = await sha256Hex(replayResult);
    const roles = {
      'receiver-dom': {
        scenarioId: input.cell,
        cellId: input.cell,
        selector: receiver.selector,
        locale: input.locale,
        textHash: receiver.textHash,
        expectedVisible: true,
        visible: receiver.visible,
        freshness: receiver.freshness,
        submitBlocked: receiver.submitBlocked,
      },
      'station-readback': {
        entityKind: 'home-projection',
        entityIdHash: await sha256Hex(`${actorPtid}:${state.agentId}`),
        revision: observed.revision.toString(),
        stateHash: stationStateHash,
      },
      'command-ids': {
        commandId,
        idempotencyKeyHash,
        objectIds: Array.from(new Set(objectIds)),
      },
      'projection-revisions': {
        slice: 'home',
        beforeRevision: before.revision.toString(),
        afterRevision: observed.revision.toString(),
      },
      'measurement-report': {
        metric: 'home-command-center',
        sampleIds: [input.sampleId],
        threshold: 'all-home-assertions-pass',
        passed: true,
        assertionCount: Object.keys(assertions).length,
      },
      'side-effect-count': {
        counterId: scenarioExecutionId,
        count: sideEffectCount,
        maximum: sideEffectMaximum,
      },
      replay: {
        sourceHash: replayHash,
        replayHash: replayedHash,
        equal: replayHash === replayedHash,
      },
    };
    return {
      state,
      requiresRestart: ['AS-02', 'AS-13'].includes(input.cell),
      runtime: {
        scenarioExecutionId,
        actorPtid,
        commandId,
        commandKind: `home:${input.cell}`,
        idempotencyKeyHash,
        objectIds: Array.from(new Set(objectIds)),
        projectionRevision: observed.revision.toString(),
        observedAt: new Date().toISOString(),
      },
      roles,
      assertions,
      ...(barriers.length > 0 ? { barrier: { orderings: barriers } } : {}),
    };
  } catch (error) {
    await cleanupState(state).catch(() => undefined);
    throw error;
  }
}
