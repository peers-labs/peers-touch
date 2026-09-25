import { api } from '../services/desktop_api';
import { imServiceV1 } from '../services/im-service';
import type {
  ConversationServiceContract,
  MessagingServiceContract,
} from '../services/im-service-contract';
import { STATION_ACTIVE_CHANGED_EVENT } from '../services/stationRegistryEvents';
import {
  MessagingProjectionKind,
  type MessagingProjectionInvalidation,
} from '../gen/proto/domain/chat/event_pb';
import {
  currentAuthenticatedActorPtid,
  useSessionStore,
} from '../store/session';
import { log } from '../utils/logger';

const RECONCILE_INTERVAL_MS = 30_000;

export interface MessagingRuntimeScope {
  actorPtid: string;
  stationPeerId: string;
  profileId: string;
  endpointId: string;
  activationGeneration: number;
}

interface MessagingLifecyclePort {
  install(): void;
  teardown(): void;
  resetProjection(): void;
  reconcile(reason: string, scope: MessagingRuntimeScope): Promise<void>;
}

export class MessagingRuntimeScopeChangedError extends Error {
  constructor() {
    super('messaging_runtime_scope_changed');
    this.name = 'MessagingRuntimeScopeChangedError';
  }
}

class DesktopMessagingDomainRuntime {
  private lifecycle: MessagingLifecyclePort | null = null;
  private installed = false;
  private activeScope: MessagingRuntimeScope | null = null;
  private activationGeneration = 0;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeSession: (() => void) | null = null;
  private scopeTransition: Promise<void> = Promise.resolve();
  private readonly onStationChanged = () => {
    this.enqueueScopeRefresh('station');
  };

  configure(lifecycle: MessagingLifecyclePort): void {
    this.lifecycle = lifecycle;
  }

  install(): void {
    if (this.installed) return;
    this.requireLifecycle().install();
    this.unsubscribeSession = useSessionStore.subscribe((state, previous) => {
      if (
        state.sessionEpoch !== previous.sessionEpoch
        || state.currentUser?.actorPtid !== previous.currentUser?.actorPtid
      ) {
        this.enqueueScopeRefresh('session');
      }
    });
    if (typeof window !== 'undefined') {
      window.addEventListener(STATION_ACTIVE_CHANGED_EVENT, this.onStationChanged);
    }
    this.installed = true;
  }

  async bootstrap(actorPtid: string | null): Promise<void> {
    const generation = ++this.activationGeneration;
    // #region debug-point A:bootstrap-entry
    void fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'A', location: 'apps/desktop/src/messaging/runtime.ts:bootstrap-entry', msg: '[DEBUG] Messaging bootstrap entered', data: { generation, actorPresent: Boolean(actorPtid), currentActorMatches: currentAuthenticatedActorPtid() === actorPtid, hadActiveScope: this.activeScope !== null }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    this.stopReconcile();
    this.activeScope = null;
    this.requireLifecycle().resetProjection();
    if (!actorPtid) {
      return;
    }

    const accountRequest = api.accountGetActive();
    const stationRequest = api.federationGetSelf();
    const endpointRequest = api.accountGetDeviceId();
    // #region debug-point B-C:scope-request-settlement
    void accountRequest.then(() => fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'B,C', location: 'apps/desktop/src/messaging/runtime.ts:account-read', msg: '[DEBUG] Messaging account scope resolved', data: { generation }, ts: Date.now() }) })).catch(() => {});
    void stationRequest.then(() => fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'B,C', location: 'apps/desktop/src/messaging/runtime.ts:station-read', msg: '[DEBUG] Messaging Station scope resolved', data: { generation }, ts: Date.now() }) })).catch(() => {});
    void endpointRequest.then(() => fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'B,C', location: 'apps/desktop/src/messaging/runtime.ts:endpoint-read', msg: '[DEBUG] Messaging endpoint scope resolved', data: { generation }, ts: Date.now() }) })).catch(() => {});
    // #endregion
    const [account, station, endpoint] = await Promise.all([
      accountRequest,
      stationRequest,
      endpointRequest,
    ]);
    const profileId = account?.id?.trim() ?? '';
    const stationPeerId = station.homeStationPeerId.trim();
    const endpointId = endpoint.device_id.trim();
    // #region debug-point B-C:scope-readback
    void fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'B,C', location: 'apps/desktop/src/messaging/runtime.ts:scope-readback', msg: '[DEBUG] Messaging scope readback completed', data: { generation, activationGeneration: this.activationGeneration, actorMatches: currentAuthenticatedActorPtid() === actorPtid, profileIdPresent: Boolean(profileId), stationPeerIdPresent: Boolean(stationPeerId), endpointIdPresent: Boolean(endpointId) }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    if (!profileId || !stationPeerId || !endpointId) {
      throw new Error('messaging_runtime_scope_incomplete');
    }
    // #region debug-point A:scope-fence
    void fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'A', location: 'apps/desktop/src/messaging/runtime.ts:scope-fence', msg: '[DEBUG] Messaging scope fence evaluated', data: { generation, activationGeneration: this.activationGeneration, actorMatches: currentAuthenticatedActorPtid() === actorPtid }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    if (currentAuthenticatedActorPtid() !== actorPtid) {
      throw new MessagingRuntimeScopeChangedError();
    }
    if (generation !== this.activationGeneration) {
      throw new MessagingRuntimeScopeChangedError();
    }
    const scope = {
      actorPtid,
      stationPeerId,
      profileId,
      endpointId,
      activationGeneration: generation,
    };
    this.activeScope = scope;
    // #region debug-point D:reconcile-window
    void fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'D', location: 'apps/desktop/src/messaging/runtime.ts:reconcile-start', msg: '[DEBUG] Messaging reconciliation started', data: { generation, activationGeneration: this.activationGeneration }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    await this.requireLifecycle().reconcile('runtime:bootstrap', scope);
    // #region debug-point D:reconcile-window
    void fetch('http://127.0.0.1:7781/event', { method: 'POST', body: JSON.stringify({ sessionId: 'messaging-scope-race', runId: 'post-fix', hypothesisId: 'D', location: 'apps/desktop/src/messaging/runtime.ts:reconcile-end', msg: '[DEBUG] Messaging reconciliation completed', data: { generation, activationGeneration: this.activationGeneration, scopeCurrent: this.isCurrent(scope) }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    this.assertCurrent(scope);
    this.startReconcile();
  }

  async reconcile(reason: string): Promise<void> {
    const scope = this.requireActiveScope();
    await this.requireLifecycle().reconcile(`runtime:reconcile:${reason}`, scope);
    this.assertCurrent(scope);
  }

  teardown(): void {
    if (!this.installed) return;
    this.clearScope();
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener(STATION_ACTIVE_CHANGED_EVENT, this.onStationChanged);
    }
    this.requireLifecycle().teardown();
    this.installed = false;
  }

  captureScope(): MessagingRuntimeScope | null {
    return this.activeScope ? { ...this.activeScope } : null;
  }

  isCurrent(scope: MessagingRuntimeScope): boolean {
    const current = this.activeScope;
    return Boolean(
      current
      && current.actorPtid === scope.actorPtid
      && current.stationPeerId === scope.stationPeerId
      && current.profileId === scope.profileId
      && current.endpointId === scope.endpointId
      && current.activationGeneration === scope.activationGeneration
      && currentAuthenticatedActorPtid() === scope.actorPtid,
    );
  }

  matchesInvalidation(payload: MessagingProjectionInvalidation): boolean {
    const current = this.activeScope;
    return Boolean(
      current
      && payload.actorPtid === current.actorPtid
      && payload.homeStationPeerId === current.stationPeerId
      && payload.deviceId === current.endpointId
      && payload.schemaVersion === 1
      && (
        payload.kind === MessagingProjectionKind.RESYNC
        || Boolean(payload.conversationId)
      )
      && payload.eventId
      && payload.laneSequence > 0n,
    );
  }

  requireActiveScope(): MessagingRuntimeScope {
    const scope = this.captureScope();
    if (!scope || currentAuthenticatedActorPtid() !== scope.actorPtid) {
      throw new MessagingRuntimeScopeChangedError();
    }
    return scope;
  }

  async runScoped<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const scope = this.requireActiveScope();
    const result = await operation();
    this.assertCurrent(scope);
    return result;
  }

  private requireLifecycle(): MessagingLifecyclePort {
    if (!this.lifecycle) throw new Error('messaging_runtime_not_configured');
    return this.lifecycle;
  }

  private assertCurrent(scope: MessagingRuntimeScope): void {
    if (!this.isCurrent(scope)) throw new MessagingRuntimeScopeChangedError();
  }

  private clearScope(): void {
    this.activationGeneration += 1;
    this.stopReconcile();
    this.activeScope = null;
    this.lifecycle?.resetProjection();
  }

  private enqueueScopeRefresh(reason: string): void {
    const actorPtid = currentAuthenticatedActorPtid();
    this.scopeTransition = this.scopeTransition
      .then(() => this.bootstrap(actorPtid))
      .catch((error) => {
        if (error instanceof MessagingRuntimeScopeChangedError) return;
        log.warn('messagingRuntime', 'scope refresh failed', { reason, error });
      });
  }

  private startReconcile(): void {
    if (this.reconcileTimer !== null) return;
    this.reconcileTimer = globalThis.setInterval(() => {
      void this.reconcile('periodic').catch(() => {});
    }, RECONCILE_INTERVAL_MS);
  }

  private stopReconcile(): void {
    if (this.reconcileTimer === null) return;
    globalThis.clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
  }
}

export const messagingDomainRuntime = new DesktopMessagingDomainRuntime();

function scopeService<TService extends object>(service: TService): TService {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      const operation = value as (...args: unknown[]) => Promise<unknown>;
      return (...args: unknown[]) => messagingDomainRuntime.runScoped(
        () => operation.apply(target, args),
      );
    },
  });
}

export const messagingCommands = scopeService<MessagingServiceContract>(
  imServiceV1.messaging,
);

export const messagingConversations = scopeService<ConversationServiceContract>(
  imServiceV1.conversation,
);

export const messagingInteractions = {
  sendTyping: (conversationId: string, typing: boolean) =>
    messagingDomainRuntime.runScoped(
      () => api.messagingTypingSend(conversationId, typing),
    ),
  markRead: (conversationId: string, lastReadSequence: number) =>
    messagingDomainRuntime.runScoped(
      () => api.messagingReadCursor(conversationId, lastReadSequence),
    ),
  editMessage: (conversationId: string, messageId: string, plaintext: string) =>
    messagingDomainRuntime.runScoped(
      () => api.messagingEditMessage(conversationId, messageId, plaintext),
    ),
  mutateMetadata: (
    conversationId: string,
    messageId: string,
    kind: 'retract' | 'reaction' | 'pin',
    options: { reaction?: string; remove?: boolean } = {},
  ) => messagingDomainRuntime.runScoped(
    () => api.messagingMetadataInteraction(
      conversationId,
      messageId,
      kind,
      options,
    ),
  ),
};
