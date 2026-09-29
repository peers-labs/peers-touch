import { identityRuntime } from '../../kernel/identityRuntime';
import { api } from '../../services/desktop_api';
import { useOAuth2Store } from '../../store/oauth2';
import { useSessionStore } from '../../store/session';
import { registerAcceptanceHarness } from '../registry';
import { configureCurrentAcceptanceStation } from '../stationAccess';
import {
  isChatAuthenticatedReady,
  runChatPasswordLogin,
  type ChatIdentityLoginState,
} from '../chat/passwordLogin';

interface ConfigureStationInput {
  stationUrl: string;
}

interface ActorInput {
  actorPtid: string;
}

interface OAuthLoginInput {
  providerId: string;
}

interface OAuthLoopbackStart {
  authUrl: string;
  sessionId: string;
}

let pendingOAuthLogin:
  | { providerId: string; flow: Promise<void> }
  | null = null;

function identityState(): ChatIdentityLoginState & { actorPtid: string } {
  const snapshot = identityRuntime.getSnapshot();
  return {
    phaseKind: snapshot.phase.kind,
    lifecycleState: snapshot.lifecycle.state,
    dataReady: snapshot.lifecycle.dataReady,
    authenticated: useSessionStore.getState().authenticated,
    actorPtid: useSessionStore.getState().currentUser?.actorPtid ?? '',
  };
}

function waitForIdentityState(
  predicate: (state: ChatIdentityLoginState) => boolean,
  description: string,
): Promise<void> {
  if (predicate(identityState())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(`acceptance.stationAccess.timeout:${description}`));
    }, 30_000);
    const unsubscribe = identityRuntime.subscribe(() => {
      if (!predicate(identityState())) return;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

export function installAcceptanceHarness(): void {
  registerAcceptanceHarness('stationAccess', {
    configureStation: ({ stationUrl }: ConfigureStationInput) =>
      configureCurrentAcceptanceStation(stationUrl),

    async bindingState() {
      const registry = await api.stationList();
      return {
        ...registry.binding,
        activeUrl: registry.active_url ?? null,
      };
    },

    async identityState() {
      return identityState();
    },

    async beginOAuthLogin({ providerId }: OAuthLoginInput) {
      if (pendingOAuthLogin) {
        throw new Error('acceptance.stationAccess.oauthAlreadyPending');
      }
      let resolveStart!: (start: OAuthLoopbackStart) => void;
      let rejectStart!: (error: unknown) => void;
      const started = new Promise<OAuthLoopbackStart>((resolve, reject) => {
        resolveStart = resolve;
        rejectStart = reject;
      });
      const flow = useOAuth2Store.getState().startAuth(providerId, undefined, {
        onLoopbackStarted: resolveStart,
        openAuthorizationUrl: async () => {},
      });
      flow.catch(rejectStart);
      pendingOAuthLogin = { providerId, flow };
      try {
        return await started;
      } catch (error) {
        pendingOAuthLogin = null;
        throw error;
      }
    },

    async completeOAuthLogin({ providerId }: OAuthLoginInput) {
      const pending = pendingOAuthLogin;
      if (!pending || pending.providerId !== providerId) {
        throw new Error('acceptance.stationAccess.oauthSessionMismatch');
      }
      try {
        await pending.flow;
        await identityRuntime.loginWithOAuthBridge();
        await identityRuntime.completeCurrentSession();
        await waitForIdentityState(
          isChatAuthenticatedReady,
          'authenticated OAuth identity lifecycle',
        );
        return identityState();
      } finally {
        pendingOAuthLogin = null;
      }
    },

    async loginWithPassword({ account, password }: { account: string; password: string }) {
      await runChatPasswordLogin({
        boot: () => identityRuntime.boot(),
        readState: identityState,
        waitFor: waitForIdentityState,
        logout: () => identityRuntime.logout(),
        loginWithPassword: (loginAccount, loginPassword) =>
          identityRuntime.loginWithPassword(loginAccount, loginPassword),
        completeCurrentSession: () => identityRuntime.completeCurrentSession(),
      }, account, password);
      return {
        authenticated: true,
        actorPtid: identityState().actorPtid,
      };
    },

    async scopeState({ actorPtid }: ActorInput) {
      const activeActorPtid = identityState().actorPtid;
      if (!activeActorPtid || activeActorPtid !== actorPtid) {
        throw new Error('acceptance.stationAccess.actorPtidMismatch');
      }
      const [registry, endpoint] = await Promise.all([
        api.stationList(),
        api.messagingAcceptanceCurrentEndpoint(actorPtid),
      ]);
      const activeUrl = registry.active_url ?? null;
      const activeEntry = registry.entries.find((entry) => entry.url === activeUrl);
      return {
        phase: identityRuntime.getSnapshot().phase.kind,
        authenticated: useSessionStore.getState().authenticated,
        stationPeerId: activeEntry?.peer_id ?? null,
        actorPtid: activeActorPtid,
        deviceId: endpoint.device_id,
        bindingPhase: registry.binding.phase,
      };
    },
  });
}
