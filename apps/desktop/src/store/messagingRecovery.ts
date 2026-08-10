import { createDesktopStore } from './createDesktopStore';
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

export const useMessagingRecoveryStore = createDesktopStore<MessagingRecoveryStore>(
  'messagingRecovery',
  (set) => ({
    ...initialState,

    reset(): void {
      set({ ...initialState });
    },

    async refresh(): Promise<void> {
      set({ loading: true, error: null });
      try {
        const status = await messagingRecoveryService.status();
        set({
          identity: status.identity,
          latest: status.latest,
          exists: status.exists,
          loading: false,
        });
      } catch (error) {
        set({
          identity: null,
          latest: null,
          exists: false,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async createRevision(recoveryPhrase): Promise<MessagingRecoveryResult> {
      set({ creating: true, error: null });
      try {
        const result = await messagingRecoveryService.createRevision(recoveryPhrase);
        set({
          exists: true,
          latest: result.backup,
          creating: false,
        });
        return result;
      } catch (error) {
        set({
          creating: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async restoreLatest(recoveryPhrase): Promise<MessagingRecoveryRestoreResult> {
      set({ restoring: true, error: null });
      try {
        const result = await messagingRecoveryService.restoreLatest(recoveryPhrase);
        const status = await messagingRecoveryService.status();
        set({
          identity: status.identity,
          exists: status.exists,
          latest: status.latest,
          restoring: false,
        });
        return result;
      } catch (error) {
        set({
          restoring: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
);
