import type {
  AtelierRuntime,
  AtelierProviderCapabilitiesResponse,
  AtelierRuntimeSnapshot,
  AtelierRuntimeStatus,
  CreateProjectFromGoalInput,
  ListProviderCapabilitiesInput,
  OpenWorkspaceInput,
  OpenWorkspaceResponse,
  FetchArtifactBodyInput,
  FetchArtifactBodyResponse,
  ResolveDecisionInput,
  OpenArtifactPreviewInput,
  OpenArtifactPreviewResponse,
  SendMessageInput,
  SetTaskStatusInput,
  SubmitFeedbackInput,
  SubmitFeedbackResponse,
} from './runtime';
import { readyStatus } from './runtime';
import type {
  AtelierProjectionEvent,
  AtelierProjectionPatch,
  AtelierProjectionSnapshot,
  AtelierRuntimeCall,
  AtelierRuntimeMethod,
  AtelierRuntimePayloadByMethod,
  AtelierRuntimeResponseByMethod,
} from './projection';
import {
  assertAtelierProjectionSnapshot,
  fromProjectionSnapshot,
  parseAtelierProjectionEvent,
} from './projection';
import {
  clonePrototypeBridgeRuntimeSnapshot,
  derivePrototypeBridgeCallStatusStart,
  shouldApplyPrototypeBridgeCallStatus,
  shouldApplyPrototypeBridgeSnapshotResponse,
} from './prototypeBridgeRuntimeCallPolicy';
import {
  prototypeBridgeProjectionSubscriptionRejectedError,
} from './prototypeBridgeProjectionEventPolicy';

export interface AtelierRuntimeBridge {
  call<M extends AtelierRuntimeMethod>(
    request: AtelierRuntimeCall<M>,
  ): Promise<AtelierRuntimeResponseByMethod[M]>;
  subscribeProjection?(listener: (event: unknown) => void): unknown;
}

type NonSnapshotAtelierRuntimeMethod =
  | 'atelier.provider.capabilities'
  | 'atelier.feedback.submit'
  | 'atelier.memory.confirmCandidate'
  | 'atelier.feedback.confirmRerun'
  | 'atelier.workspace.open'
  | 'atelier.artifact.body.fetch'
  | 'atelier.artifact.preview.open';

type SnapshotAtelierRuntimeMethod = Exclude<AtelierRuntimeMethod, NonSnapshotAtelierRuntimeMethod>;

export function createBridgeAtelierRuntime({
  bridge,
  initialSnapshot,
}: {
  bridge: AtelierRuntimeBridge;
  initialSnapshot: AtelierProjectionSnapshot;
}): AtelierRuntime {
  let snapshot = withStatus(toRuntimeSnapshot(initialSnapshot), loadingStatus());
  const listeners = new Set<(snapshot: AtelierRuntimeSnapshot) => void>();
  const seenEventKeys = new Set<string>();
  const seenEventOrder: string[] = [];
  const lastSeqByScope = new Map<string, number>();
  let unsubscribeBridge: (() => void) | undefined;
  let activeProjectionSubscriptionToken = 0;
  let latestCallStatusToken = 0;
  let activeCallRestorableStatus: AtelierRuntimeStatus | undefined;
  let latestSnapshotCallToken = 0;
  let projectionRevision = 0;

  const emit = () => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(cloneSnapshot(snapshot));
      } catch (error) {
        console.warn('Atelier bridge runtime listener failed', error);
      }
    }
  };

  const setFromProjection = (projection: AtelierProjectionSnapshot) => {
    const nextSnapshot = toRuntimeSnapshot(projection);
    projectionRevision += 1;
    snapshot = withStatus(nextSnapshot);
    emit();
    return cloneSnapshot(snapshot);
  };

  const ensureBridgeSubscription = () => {
    if (unsubscribeBridge || !bridge.subscribeProjection) return;
    snapshot = withStatus(snapshot, reconcilingStatus());
    emit();
    const projectionSubscriptionToken = ++activeProjectionSubscriptionToken;
    let subscriptionReady = false;
    let cleanup: unknown;
    try {
      cleanup = bridge.subscribeProjection((incomingEvent) => {
        if (
          !subscriptionReady
          || projectionSubscriptionToken !== activeProjectionSubscriptionToken
        ) return;
        try {
          const subscriptionRejectedError =
            prototypeBridgeProjectionSubscriptionRejectedError(incomingEvent);
          if (subscriptionRejectedError) {
            projectionRevision += 1;
            snapshot = withStatus(snapshot, statusFromBridgeError(subscriptionRejectedError));
            emit();
            return;
          }
          const event = parseAtelierProjectionEvent(incomingEvent);
          if (!event) {
            snapshot = withStatus(snapshot, statusFromBridgeError(new Error('invalid projection event')));
            emit();
            return;
          }
          if (!canApplyPatchToKnownTask(snapshot, event.patch)) {
            snapshot = withStatus(snapshot, statusFromBridgeError(new Error('projection event references unknown task')));
            emit();
            return;
          }
          if (!rememberProjectionEvent(event, seenEventKeys, seenEventOrder)) return;
          const hasGap = hasProjectionSeqGap(event, lastSeqByScope);
          if (!rememberProjectionSeq(event, lastSeqByScope)) {
            snapshot = withStatus(snapshot, degradedStatus(event.seq));
            emit();
            return;
          }
          projectionRevision += 1;
          if (hasGap || event.patch.kind === 'snapshot.invalidate') {
            snapshot = withStatus(snapshot, reconcilingStatus());
            emit();
            void callSnapshot('atelier.workspace.load', {});
            return;
          }
          snapshot = withStatus(applyPatch(snapshot, event.patch), eventStatus(event.seq));
          emit();
        } catch (error) {
          snapshot = withStatus(snapshot, statusFromBridgeError(error));
          emit();
        }
      });
    } catch (error) {
      unsubscribeBridge = undefined;
      snapshot = withStatus(snapshot, statusFromBridgeError(error));
      emit();
      return;
    }

    if (typeof cleanup !== 'function') {
      unsubscribeBridge = undefined;
      snapshot = withStatus(snapshot, statusFromBridgeError(new Error('projection stream returned malformed unsubscribe cleanup')));
      emit();
      return;
    }

    unsubscribeBridge = cleanup;
    const ready = projectionSubscriptionReady(cleanup);
    if (!ready) {
      subscriptionReady = true;
      snapshot = withStatus(snapshot, readyStatus(snapshot.state));
      emit();
      return;
    }
    void ready.then(() => {
      if (
        unsubscribeBridge !== cleanup
        || projectionSubscriptionToken !== activeProjectionSubscriptionToken
      ) return;
      subscriptionReady = true;
      snapshot = withStatus(snapshot, readyStatus(snapshot.state));
      emit();
    }).catch((error: unknown) => {
      if (
        unsubscribeBridge !== cleanup
        || projectionSubscriptionToken !== activeProjectionSubscriptionToken
      ) return;
      unsubscribeBridge = undefined;
      snapshot = withStatus(snapshot, statusFromBridgeError(error));
      emit();
    });
  };

  const releaseBridgeSubscription = () => {
    const cleanup = unsubscribeBridge;
    unsubscribeBridge = undefined;
    activeProjectionSubscriptionToken += 1;
    if (!cleanup) return;
    try {
      cleanup();
    } catch (error) {
      console.warn('Atelier bridge runtime cleanup failed', error);
      snapshot = withStatus(snapshot, statusFromBridgeError(error));
      emit();
    }
  };

  const call = async <M extends AtelierRuntimeMethod>(
    method: M,
    payload: AtelierRuntimePayloadByMethod[M],
    options: { restoreStatusOnSuccess?: boolean } = {},
  ): Promise<AtelierRuntimeResponseByMethod[M]> => {
    const callStatusToken = ++latestCallStatusToken;
    const projectionRevisionAtCall = projectionRevision;
    const callStatus = derivePrototypeBridgeCallStatusStart({
      currentStatus: snapshot.status,
      activeRestorableStatus: activeCallRestorableStatus,
      readyStatus: readyStatus(snapshot.state),
    });
    const previousStatus = callStatus.previousStatus;
    activeCallRestorableStatus = callStatus.nextActiveRestorableStatus;
    snapshot = withStatus(snapshot, loadingStatus());
    emit();
    try {
      const response = await bridge.call({ method, payload });
      if (shouldApplyPrototypeBridgeCallStatus({
        callStatusToken,
        latestCallStatusToken,
        projectionRevisionAtCall,
        projectionRevision,
      })) {
        activeCallRestorableStatus = undefined;
        if (options.restoreStatusOnSuccess ?? true) {
          snapshot = withStatus(snapshot, previousStatus);
          emit();
        }
      } else if (
        callStatusToken === latestCallStatusToken
        && snapshot.status?.kind === 'loading'
      ) {
        activeCallRestorableStatus = undefined;
        snapshot = withStatus(snapshot, previousStatus);
        emit();
      }
      return response;
    } catch (error) {
      if (shouldApplyPrototypeBridgeCallStatus({
        callStatusToken,
        latestCallStatusToken,
        projectionRevisionAtCall,
        projectionRevision,
      })) {
        activeCallRestorableStatus = undefined;
        snapshot = withStatus(snapshot, statusFromBridgeError(error));
        emit();
      } else if (
        callStatusToken === latestCallStatusToken
        && snapshot.status?.kind === 'loading'
      ) {
        activeCallRestorableStatus = undefined;
        snapshot = withStatus(snapshot, previousStatus);
        emit();
      }
      throw error;
    }
  };

  const callSnapshot = async <M extends SnapshotAtelierRuntimeMethod>(
    method: M,
    payload: AtelierRuntimePayloadByMethod[M],
  ) => {
    const snapshotCallToken = ++latestSnapshotCallToken;
    const projectionRevisionAtCall = projectionRevision;
    try {
      const projection = await call(method, payload, { restoreStatusOnSuccess: false }) as AtelierProjectionSnapshot;
      if (!shouldApplyPrototypeBridgeSnapshotResponse({
        snapshotCallToken,
        latestSnapshotCallToken,
        projectionRevisionAtCall,
        projectionRevision,
      })) return cloneSnapshot(snapshot);
      return setFromProjection(projection);
    } catch (error) {
      if (!shouldApplyPrototypeBridgeSnapshotResponse({
        snapshotCallToken,
        latestSnapshotCallToken,
        projectionRevisionAtCall,
        projectionRevision,
      })) return cloneSnapshot(snapshot);
      snapshot = withStatus(snapshot, statusFromBridgeError(error));
      emit();
      return cloneSnapshot(snapshot);
    }
  };

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    subscribe(listener) {
      listeners.add(listener);
      ensureBridgeSubscription();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) releaseBridgeSubscription();
      };
    },
    loadWorkspace() {
      return callSnapshot('atelier.workspace.load', {});
    },
    createProjectFromGoal(input: CreateProjectFromGoalInput) {
      return callSnapshot('atelier.project.createFromGoal', input);
    },
    sendMessage(input: SendMessageInput) {
      return callSnapshot('atelier.message.send', input);
    },
    resolveDecision(input: ResolveDecisionInput) {
      return callSnapshot('atelier.escalation.resolve', input);
    },
    setTaskStatus(input: SetTaskStatusInput) {
      return callSnapshot('atelier.task.setStatus', input);
    },
    purgeTask(taskId: string) {
      return callSnapshot('atelier.task.purge', { taskId });
    },
    async listProviderCapabilities(input: ListProviderCapabilitiesInput = {}): Promise<AtelierProviderCapabilitiesResponse> {
      return call('atelier.provider.capabilities', input);
    },
    async submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse> {
      return call('atelier.feedback.submit', input);
    },
    async confirmMemoryCandidate(input) {
      return call('atelier.memory.confirmCandidate', input);
    },
    async confirmRerun(input) {
      return call('atelier.feedback.confirmRerun', input);
    },
    async openWorkspace(input: OpenWorkspaceInput): Promise<OpenWorkspaceResponse> {
      return call('atelier.workspace.open', input);
    },
    async fetchArtifactBody(input: FetchArtifactBodyInput): Promise<FetchArtifactBodyResponse> {
      return call('atelier.artifact.body.fetch', input);
    },
    async openArtifactPreview(input: OpenArtifactPreviewInput): Promise<OpenArtifactPreviewResponse> {
      return call('atelier.artifact.preview.open', input);
    },
    async setModel(model: string) {
      projectionRevision += 1;
      snapshot = {
        ...snapshot,
        state: {
          ...snapshot.state,
          model,
        },
      };
      emit();
      return cloneSnapshot(snapshot);
    },
  };
}

function projectionSubscriptionReady(cleanup: () => void): Promise<void> | undefined {
  const ready = (cleanup as (() => void) & { ready?: unknown }).ready;
  if (!ready || (typeof ready !== 'object' && typeof ready !== 'function')) {
    return undefined;
  }
  const then = (ready as { then?: unknown }).then;
  return typeof then === 'function'
    ? Promise.resolve(ready as PromiseLike<void>)
    : undefined;
}

function toRuntimeSnapshot(projection: unknown): AtelierRuntimeSnapshot {
  return clonePrototypeBridgeRuntimeSnapshot(
    fromProjectionSnapshot(assertAtelierProjectionSnapshot(projection)),
  );
}

function withStatus(
  snapshot: AtelierRuntimeSnapshot,
  status: AtelierRuntimeStatus = readyStatus(snapshot.state),
): AtelierRuntimeSnapshot {
  return { ...snapshot, status };
}

function applyPatch(snapshot: AtelierRuntimeSnapshot, patch: AtelierProjectionPatch): AtelierRuntimeSnapshot {
  if (patch.kind === 'snapshot') return toRuntimeSnapshot(patch.snapshot);

  const state = cloneSnapshot(snapshot).state;
  switch (patch.kind) {
    case 'snapshot.invalidate':
      break;
    case 'task.upsert': {
      const exists = state.tasks.some((task) => task.id === patch.task.id);
      state.tasks = exists
        ? state.tasks.map((task) => (task.id === patch.task.id ? patch.task : task))
        : [patch.task, ...state.tasks];
      if (patch.select) state.selectedTaskId = patch.task.id;
      break;
    }
    case 'task.status':
      state.tasks = state.tasks.map((task) =>
        task.id === patch.taskId ? { ...task, status: patch.status } : task,
      );
      break;
    case 'stream.append':
      state.stream[patch.taskId] = appendUniqueBlocks(state.stream[patch.taskId] ?? [], patch.blocks);
      break;
    case 'decision.resolved':
      state.stream[patch.taskId] = (state.stream[patch.taskId] ?? []).map((block) =>
        block.kind === 'decision' && block.id === patch.blockId
          ? { ...block, chosen: patch.choice }
          : block,
      );
      break;
    case 'artifact.upsert': {
      state.artifacts[patch.taskId] = upsertById(state.artifacts[patch.taskId] ?? [], patch.artifact);
      break;
    }
    case 'gate.upsert': {
      state.gates[patch.taskId] = upsertById(state.gates[patch.taskId] ?? [], patch.gate);
      break;
    }
    case 'context.replace':
      state.context[patch.taskId] = patch.context;
      break;
    case 'todo.replace':
      state.todos[patch.taskId] = patch.todos;
      break;
    default:
      assertNever(patch);
  }

  return { state, selectedTaskId: state.selectedTaskId };
}

function canApplyPatchToKnownTask(snapshot: AtelierRuntimeSnapshot, patch: AtelierProjectionPatch): boolean {
  if (
    patch.kind === 'snapshot'
    || patch.kind === 'snapshot.invalidate'
    || patch.kind === 'task.upsert'
  ) return true;
  return snapshot.state.tasks.some((task) => task.id === patch.taskId);
}

function cloneSnapshot(snapshot: AtelierRuntimeSnapshot): AtelierRuntimeSnapshot {
  return clonePrototypeBridgeRuntimeSnapshot(snapshot);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Atelier projection patch: ${JSON.stringify(value)}`);
}

const MAX_SEEN_EVENT_KEYS = 500;

function rememberProjectionEvent(
  event: AtelierProjectionEvent,
  seenEventKeys: Set<string>,
  seenEventOrder: string[],
): boolean {
  const key = projectionEventKey(event);
  if (seenEventKeys.has(key)) return false;

  seenEventKeys.add(key);
  seenEventOrder.push(key);

  while (seenEventOrder.length > MAX_SEEN_EVENT_KEYS) {
    const stale = seenEventOrder.shift();
    if (stale) seenEventKeys.delete(stale);
  }

  return true;
}

function rememberProjectionSeq(
  event: AtelierProjectionEvent,
  lastSeqByScope: Map<string, number>,
): boolean {
  const scope = projectionEventScope(event);
  const lastSeq = lastSeqByScope.get(scope);
  if (lastSeq !== undefined && event.seq <= lastSeq) return false;
  lastSeqByScope.set(scope, event.seq);
  return true;
}

function hasProjectionSeqGap(
  event: AtelierProjectionEvent,
  lastSeqByScope: Map<string, number>,
): boolean {
  const lastSeq = lastSeqByScope.get(projectionEventScope(event));
  return lastSeq !== undefined && event.seq > lastSeq + 1;
}

function projectionEventKey(event: AtelierProjectionEvent): string {
  if (event.id) return `id:${event.id}`;
  return `seq:${projectionEventScope(event)}:${event.seq}`;
}

function projectionEventScope(event: AtelierProjectionEvent): string {
  if (event.patch.kind === 'snapshot.invalidate') {
    return event.patch.taskId
      ? `task:${event.patch.taskId}`
      : `goal:${event.patch.goalId}`;
  }
  return event.taskId ?? 'workspace';
}

function appendUniqueBlocks<TBlock extends { id: string }>(current: TBlock[], incoming: TBlock[]): TBlock[] {
  if (incoming.length === 0) return current;

  const existingIds = new Set(current.map((block) => block.id));
  const uniqueIncoming = incoming.filter((block) => {
    if (existingIds.has(block.id)) return false;
    existingIds.add(block.id);
    return true;
  });

  return uniqueIncoming.length > 0 ? [...current, ...uniqueIncoming] : current;
}

function upsertById<TItem extends { id: string }>(current: TItem[], incoming: TItem): TItem[] {
  const exists = current.some((item) => item.id === incoming.id);
  return exists
    ? current.map((item) => (item.id === incoming.id ? incoming : item))
    : [...current, incoming];
}

function loadingStatus(): AtelierRuntimeStatus {
  return {
    kind: 'loading',
    title: '正在加载 Atelier projection',
    detail: '等待 Desktop Host 通过 applet bridge 返回 Station workspace snapshot。',
  };
}

function eventStatus(lastEventSeq: number): AtelierRuntimeStatus {
  return {
    kind: 'ready',
    title: 'Projection 已连接',
    detail: '正在消费 Station / Agent orchestration 投影事件。',
    lastEventSeq,
  };
}

function reconcilingStatus(): AtelierRuntimeStatus {
  return {
    kind: 'reconciling',
    title: 'Projection 正在同步',
    detail: '已保留当前 snapshot，正在连接 Desktop Host 的 Atelier projection event stream。',
  };
}

function degradedStatus(lastEventSeq: number): AtelierRuntimeStatus {
  return {
    kind: 'degraded',
    title: 'Projection 降级',
    detail: '收到过期 projection event，已拒绝应用并保留最后一份有效 snapshot。',
    retryable: true,
    lastEventSeq,
  };
}

function statusFromBridgeError(error: unknown): AtelierRuntimeStatus {
  const message = error instanceof Error ? error.message : String(error);
  const code = bridgeErrorCode(error);
  const normalized = `${code ?? ''} ${message}`.toLowerCase();
  if (
    code === 'PERMISSION_DENIED' ||
    code === 'FORBIDDEN' ||
    code === 'UNAUTHORIZED' ||
    normalized.includes('permission') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('auth')
  ) {
    return {
      kind: 'auth-denied',
      title: 'Atelier 权限被拒绝',
      detail: '当前 applet session 没有 Atelier projection capability，或登录身份已失效。',
      retryable: false,
    };
  }
  if (
    code === 'CONNECTION_CLOSED' ||
    code === 'NETWORK_DISCONNECTED' ||
    code === 'TIMEOUT' ||
    normalized.includes('network') ||
    normalized.includes('timeout') ||
    normalized.includes('disconnect') ||
    normalized.includes('stream')
  ) {
    return {
      kind: 'disconnected',
      title: 'Projection 连接中断',
      detail: 'Desktop Host 暂时无法连接 Station projection stream；当前页面保留最后一次 snapshot。',
      retryable: true,
    };
  }
  return {
    kind: 'error',
    title: 'Projection 加载失败',
    detail: message || 'Host bridge 返回了无法识别的 projection 响应。',
    retryable: true,
  };
}

function bridgeErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if (
    error instanceof Error
    && error.cause
    && typeof error.cause === 'object'
    && 'code' in error.cause
    && typeof error.cause.code === 'string'
  ) {
    return error.cause.code;
  }
  return undefined;
}
