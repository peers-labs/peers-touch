import { createDesktopStore } from './createDesktopStore';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';
import { EVENT, eventBus } from '../kernel/events';
import {
  messagingRecoveryService,
  type MessagingRecoveryIdentity,
  type MessagingRecoveryRestoreResult,
  type MessagingRecoveryRevision,
  type MessagingRecoveryResult,
} from '../services/messaging-recovery-service';

interface MessagingRecoveryState {
  identity: MessagingRecoveryIdentity | null;
  latest: MessagingRecoveryRevision | null;
  exists: boolean;
  loading: boolean;
  creating: boolean;
  restoring: boolean;
  error: string | null;
}

interface MessagingRecoveryActions {
  reset(): void;
  refresh(): Promise<void>;
  createRevision(recoveryPhrase: string): Promise<MessagingRecoveryResult>;
  restoreLatest(recoveryPhrase: string): Promise<MessagingRecoveryRestoreResult>;
}

type MessagingRecoveryStore = MessagingRecoveryState & MessagingRecoveryActions;

const initialState: MessagingRecoveryState = {
  identity: null,
  latest: null,
  exists: false,
  loading: false,
  creating: false,
  restoring: false,
  error: null,
};

let scopeGeneration = 0;
let statusSequence = 0;

function currentScopeGuard(): () => boolean {
  const actorPtid = currentAuthenticatedActorPtid();
  const sessionEpoch = useSessionStore.getState().sessionEpoch;
  const generation = scopeGeneration;
  return () => actorPtid !== null
    && actorPtid === currentAuthenticatedActorPtid()
    && sessionEpoch === useSessionStore.getState().sessionEpoch
    && generation === scopeGeneration;
}

export const useMessagingRecoveryStore = createDesktopStore<MessagingRecoveryStore>(
  'messagingRecovery',
  (set) => ({
    ...initialState,

    reset(): void {
      scopeGeneration += 1;
      set({ ...initialState });
    },

    async refresh(): Promise<void> {
      if (!currentAuthenticatedActorPtid()) {
        scopeGeneration += 1;
        set({ ...initialState });
        return;
      }
      const scopeCurrent = currentScopeGuard();
      const sequence = ++statusSequence;
      const isCurrent = () => scopeCurrent() && sequence === statusSequence;
      set({ loading: true, error: null });
      try {
        const status = await messagingRecoveryService.status();
        if (!isCurrent()) return;
        set({
          identity: status.identity,
          latest: status.latest,
          exists: status.exists,
          loading: false,
        });
      } catch (error) {
        if (isCurrent()) {
          set({
            identity: null,
            latest: null,
            exists: false,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },

    async createRevision(recoveryPhrase): Promise<MessagingRecoveryResult> {
      if (!currentAuthenticatedActorPtid()) throw new Error('authentication required');
      const isCurrent = currentScopeGuard();
      set({ creating: true, error: null });
      try {
        const result = await messagingRecoveryService.createRevision(recoveryPhrase);
        if (!isCurrent()) return result;
        statusSequence += 1;
        set({
          exists: true,
          latest: result.backup,
          loading: false,
          creating: false,
        });
        return result;
      } catch (error) {
        if (isCurrent()) {
          set({
            creating: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },

    async restoreLatest(recoveryPhrase): Promise<MessagingRecoveryRestoreResult> {
      if (!currentAuthenticatedActorPtid()) throw new Error('authentication required');
      const isCurrent = currentScopeGuard();
      set({ restoring: true, error: null });
      try {
        const result = await messagingRecoveryService.restoreLatest(recoveryPhrase);
        if (!isCurrent()) return result;
        if (
          result.actorPtid !== currentAuthenticatedActorPtid()
          || !result.profileId?.trim()
          || !result.stationPeerId?.trim()
          || !result.deviceId?.trim()
        ) throw new Error('messaging recovery activation binding is invalid');
        eventBus.publish(EVENT.MESSAGING_PROFILE_ACTIVATED, {
          actorPtid: result.actorPtid,
          sessionEpoch: useSessionStore.getState().sessionEpoch,
          profileId: result.profileId,
          stationPeerId: result.stationPeerId,
          endpointId: result.deviceId,
        });
        statusSequence += 1;
        const status = await messagingRecoveryService.status();
        if (!isCurrent()) return result;
        set({
          identity: status.identity,
          exists: status.exists,
          latest: status.latest,
          loading: false,
          restoring: false,
        });
        return result;
      } catch (error) {
        if (isCurrent()) {
          set({
            restoring: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      }
    },
  }),
);
