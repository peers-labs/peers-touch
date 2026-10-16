import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  groupInvitations: vi.fn(),
  decideGroupInvitation: vi.fn(),
}));
const session = vi.hoisted(() => ({
  actorPtid: 'ptid:self' as string | null,
  sessionEpoch: 1,
}));

vi.mock('../services/desktop_api', () => ({ api }));
vi.mock('./session', () => ({
  currentAuthenticatedActorPtid: () => session.actorPtid,
  useSessionStore: {
    getState: () => ({ sessionEpoch: session.sessionEpoch }),
  },
}));

import { useGroupInvitationStore } from './groupInvitations';

const invitation = {
  version: 1,
  invitationId: 'invitation-1',
  conversationId: 'group-1',
  federationId: 'federation-1',
  authorityStationPeerId: 'station-authority',
  authorityEpoch: 1,
  inviterPtid: 'ptid:alice',
  inviteePtid: 'ptid:self',
  inviteeHomeStationPeerId: 'station-home',
  state: 1,
  groupNameSnapshot: 'Trusted group',
  createdAt: null,
  expiresAt: null,
  decidedAt: null,
  decisionCommandId: '',
  fulfillmentTransitionId: '',
  policyRevision: 4,
};

describe('group invitation projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.actorPtid = 'ptid:self';
    session.sessionEpoch = 1;
    useGroupInvitationStore.getState().reset();
  });

  it('reconciles pending and accepted-waiting invitations', async () => {
    api.groupInvitations.mockResolvedValue({ invitations: [invitation] });

    await useGroupInvitationStore.getState().refresh();

    expect(api.groupInvitations).toHaveBeenCalledWith([1, 2]);
    expect(useGroupInvitationStore.getState()).toMatchObject({
      invitations: [invitation],
      loading: false,
      error: null,
    });
  });

  it('keeps an accepted invitation visible until MLS membership commits', async () => {
    useGroupInvitationStore.setState({ invitations: [invitation] });
    const accepted = { ...invitation, state: 2 };
    api.decideGroupInvitation.mockResolvedValue({
      invitation: accepted,
      grantId: 'grant-1',
    });

    await useGroupInvitationStore.getState().decide('invitation-1', true);

    expect(api.decideGroupInvitation).toHaveBeenCalledWith({
      invitation_id: 'invitation-1',
      accept: true,
      observed_state: 1,
      observed_policy_revision: 4,
    });
    expect(useGroupInvitationStore.getState().invitations).toEqual([accepted]);
  });

  it('drops a declined invitation and fences a stale session response', async () => {
    useGroupInvitationStore.setState({ invitations: [invitation] });
    api.decideGroupInvitation.mockResolvedValue({
      invitation: { ...invitation, state: 4 },
    });

    await useGroupInvitationStore.getState().decide('invitation-1', false);
    expect(useGroupInvitationStore.getState().invitations).toEqual([]);

    let resolveRefresh!: (value: { invitations: typeof invitation[] }) => void;
    api.groupInvitations.mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const refresh = useGroupInvitationStore.getState().refresh();
    session.sessionEpoch = 2;
    resolveRefresh({ invitations: [invitation] });
    await refresh;

    expect(useGroupInvitationStore.getState().invitations).toEqual([]);
  });
});
