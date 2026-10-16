export type GroupAdmissionMode =
  | 'friends-direct-add'
  | 'friends-require-confirmation';

export type GroupInvitationState =
  | 'pending'
  | 'accepted-waiting-for-mls';

export type GroupLeaveRejectState =
  | 'rejection-committed'
  | 'leave-intent-submitted'
  | 'completed'
  | 'leave-retry-required';

export interface GroupInvitationProjection {
  invitationId: string;
  conversationId: string;
  groupName: string;
  inviterName: string;
  inviterInitials: string;
  inviterAvatarBackground: string;
  timeLabel: string;
  policyRevision: number;
  state: GroupInvitationState;
}

export interface RejectedGroupProjection {
  conversationId: string;
  groupName: string;
  operationId?: string;
  leaveState?: GroupLeaveRejectState;
  failureCode?: string;
}

export interface GroupAdmissionProjection {
  mode: GroupAdmissionMode;
  policyRevision: number;
  invitations: readonly GroupInvitationProjection[];
  rejectedGroups: readonly RejectedGroupProjection[];
}

export interface GroupAdmissionAdapter {
  subscribe(listener: () => void): () => void;
  getSnapshot(): GroupAdmissionProjection;
  updateMode(mode: GroupAdmissionMode, observedRevision: number): Promise<void>;
  decideInvitation(input: {
    invitationId: string;
    accept: boolean;
    observedState: GroupInvitationState;
    observedPolicyRevision: number;
  }): Promise<void>;
  leaveGroup(input: {
    conversationId: string;
    groupName: string;
    rejectFutureInvitations: boolean;
  }): Promise<{ state: GroupLeaveRejectState }>;
  retryLeave(operationId: string): Promise<void>;
  removeRejectedGroup(conversationId: string): Promise<void>;
}

export function createGroupAdmissionAdapter(
  initial?: Partial<GroupAdmissionProjection>,
): GroupAdmissionAdapter {
  let snapshot: GroupAdmissionProjection = {
    mode: initial?.mode ?? 'friends-direct-add',
    policyRevision: initial?.policyRevision ?? 1,
    invitations: initial?.invitations ?? [],
    rejectedGroups: initial?.rejectedGroups ?? [],
  };
  const listeners = new Set<() => void>();
  const publish = (next: GroupAdmissionProjection) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async updateMode(mode, observedRevision) {
      if (observedRevision !== snapshot.policyRevision) {
        throw new Error('Group invitation policy changed. Refresh and try again.');
      }
      publish({
        ...snapshot,
        mode,
        policyRevision: snapshot.policyRevision + 1,
      });
    },
    async decideInvitation(input) {
      const invitation = snapshot.invitations.find(
        item => item.invitationId === input.invitationId,
      );
      if (!invitation
        || invitation.state !== input.observedState
        || invitation.policyRevision !== input.observedPolicyRevision) {
        throw new Error('Invitation state changed. Refresh and try again.');
      }
      publish({
        ...snapshot,
        invitations: input.accept
          ? snapshot.invitations.map(item => (
              item.invitationId === input.invitationId
                ? { ...item, state: 'accepted-waiting-for-mls' }
                : item
            ))
          : snapshot.invitations.filter(
              item => item.invitationId !== input.invitationId,
            ),
      });
    },
    async leaveGroup(input) {
      if (!input.rejectFutureInvitations) {
        return { state: 'completed' };
      }
      const operationId = `leave-reject:${input.conversationId}`;
      const retryRequired = typeof window !== 'undefined'
        && new URLSearchParams(window.location.search).get('leaveRetry') === '1';
      const state: GroupLeaveRejectState = retryRequired
        ? 'leave-retry-required'
        : 'leave-intent-submitted';
      publish({
        ...snapshot,
        policyRevision: snapshot.policyRevision + 1,
        rejectedGroups: [
          {
            conversationId: input.conversationId,
            groupName: input.groupName,
            operationId,
            leaveState: state,
            failureCode: retryRequired ? 'LEAVE_INTENT_CREATE_REQUIRED' : undefined,
          },
          ...snapshot.rejectedGroups.filter(
            group => group.conversationId !== input.conversationId,
          ),
        ],
      });
      return { state };
    },
    async retryLeave(operationId) {
      const match = snapshot.rejectedGroups.find(
        group => group.operationId === operationId,
      );
      if (!match) throw new Error('Leave operation is no longer available.');
      publish({
        ...snapshot,
        rejectedGroups: snapshot.rejectedGroups.map(group => (
          group.operationId === operationId
            ? {
                ...group,
                leaveState: 'leave-intent-submitted',
                failureCode: undefined,
              }
            : group
        )),
      });
    },
    async removeRejectedGroup(conversationId) {
      publish({
        ...snapshot,
        policyRevision: snapshot.policyRevision + 1,
        rejectedGroups: snapshot.rejectedGroups.filter(
          group => group.conversationId !== conversationId,
        ),
      });
    },
  };
}
