import { createDesktopStore } from './createDesktopStore';
import { api, type AccountProfile, type ProfileUpdateInput, type ProfileUpdateResult } from '../services/desktop_api';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';
import { log } from '../utils/logger';

interface ProfileState {
  profile: AccountProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  reset: () => void;
  refresh: () => Promise<void>;
  update: (input: ProfileUpdateInput) => Promise<ProfileUpdateResult>;
  upload: (kind: 'avatar' | 'header', filePath: string) => Promise<ProfileUpdateResult>;
}

let readGeneration = 0;

function scopeKey(): string | null {
  const actorPtid = currentAuthenticatedActorPtid();
  return actorPtid ? `${actorPtid}\0${useSessionStore.getState().sessionEpoch}` : null;
}

export const useProfileStore = createDesktopStore<ProfileState>('profile', (set, get) => {
  const publish = (profile: AccountProfile) => {
    const actorPtid = currentAuthenticatedActorPtid();
    if (profile.peers_touch.network_id !== actorPtid) {
      throw new Error('provider.account.profile.identityMismatch');
    }
    const current = get().profile;
    if (!current || profile.profile_revision >= current.profile_revision) set({ profile });
  };
  const mutate = async (operation: () => Promise<ProfileUpdateResult>) => {
    const scope = scopeKey();
    if (!scope) throw new Error('provider.account.profile.sessionUnavailable');
    if (get().saving) throw new Error('provider.account.profile.savePending');
    readGeneration += 1;
    set({ saving: true, loading: false, error: null });
    try {
      const result = await operation();
      if (scopeKey() !== scope) throw new Error('provider.account.profile.sessionUnavailable');
      readGeneration += 1;
      publish(result.profile);
      if (result.outcome === 'PROFILE_UPDATE_OUTCOME_CONFLICT') {
        set({ error: 'provider.account.profile.conflict' });
      }
      return result;
    } catch (failure) {
      log.warn('profile', 'Profile mutation failed', failure);
      if (scopeKey() === scope) set({ error: 'provider.account.failedToUpdate' });
      throw failure;
    } finally {
      if (scopeKey() === scope) set({ saving: false });
    }
  };

  return {
    profile: null,
    loading: false,
    saving: false,
    error: null,
    reset: () => {
      readGeneration += 1;
      set({ profile: null, loading: false, saving: false, error: null });
    },
    refresh: async () => {
      const scope = scopeKey();
      if (!scope || get().saving) return;
      const generation = ++readGeneration;
      set({ loading: true });
      try {
        const profile = await api.profileGet();
        if (scopeKey() !== scope || generation !== readGeneration) return;
        publish(profile);
        set({ loading: false, error: null });
      } catch (failure) {
        if (scopeKey() !== scope || generation !== readGeneration) return;
        log.warn('profile', 'Profile reconciliation failed', failure);
        set({ loading: false, error: 'provider.account.failedToLoad' });
      }
    },
    update: (input) => mutate(() => api.profileUpdate(input)),
    upload: (kind, filePath) => mutate(() => kind === 'avatar'
      ? api.profileUploadAvatarOss({ file_path: filePath })
      : api.profileUploadHeaderOss({ file_path: filePath })),
  };
});
