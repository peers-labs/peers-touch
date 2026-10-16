import { createDesktopStore } from './createDesktopStore';
import { api, type GroupInvitationData } from '../services/desktop_api';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';
import { log } from '../utils/logger';

const PENDING = 1;
const ACCEPTED_WAITING_FOR_MLS = 2;

function sessionKey(): string | null {
  const actorPtid = currentAuthenticatedActorPtid();
  return actorPtid
    ? `${actorPtid}\0${useSessionStore.getState().sessionEpoch}`
    : null;
}

interface GroupInvitationState {
  invitations: GroupInvitationData[];
  loading: boolean;
  error: string | null;
  decidingId: string | null;
  reset: () => void;
  refresh: () => Promise<void>;
  decide: (invitationId: string, accept: boolean) => Promise<void>;
}

let generation = 0;

export const useGroupInvitationStore = createDesktopStore<GroupInvitationState>(
  'groupInvitations',
  (set, get) => ({
    invitations: [],
    loading: false,
    error: null,
    decidingId: null,

    reset: () => {
      generation += 1;
      set({
        invitations: [],
        loading: false,
        error: null,
        decidingId: null,
      });
    },

    refresh: async () => {
      const scope = sessionKey();
      if (!scope) {
        get().reset();
        return;
      }
      const requestGeneration = ++generation;
      set({ loading: true, error: null });
      try {
        const snapshot = await api.groupInvitations([
          PENDING,
          ACCEPTED_WAITING_FOR_MLS,
        ]);
        if (scope !== sessionKey() || requestGeneration !== generation) return;
        set({ invitations: snapshot.invitations, loading: false, error: null });
      } catch (error) {
        if (scope !== sessionKey() || requestGeneration !== generation) return;
        log.warn('group-invitations', 'Failed to refresh group invitations', error);
        set({
          loading: false,
          error: error instanceof Error
            ? error.message
            : 'layout.notifications.groupInvitationLoadFailed',
        });
      }
    },

    decide: async (invitationId, accept) => {
      const scope = sessionKey();
      const invitation = get().invitations.find(
        (candidate) => candidate.invitationId === invitationId,
      );
      if (!scope || !invitation || get().decidingId) return;
      set({ decidingId: invitationId, error: null });
      try {
        const result = await api.decideGroupInvitation({
          invitation_id: invitation.invitationId,
          accept,
          observed_state: invitation.state,
          observed_policy_revision: invitation.policyRevision,
        });
        if (scope !== sessionKey()) return;
        set((state) => ({
          invitations: accept
            ? state.invitations.map((candidate) => (
                candidate.invitationId === invitationId
                  ? result.invitation
                  : candidate
              ))
            : state.invitations.filter(
                (candidate) => candidate.invitationId !== invitationId,
              ),
        }));
      } catch (error) {
        if (scope !== sessionKey()) return;
        set({
          error: error instanceof Error
            ? error.message
            : 'layout.notifications.actionFailed',
        });
        throw error;
      } finally {
        if (scope === sessionKey()) {
          set({ decidingId: null });
        }
      }
    },
  }),
);
