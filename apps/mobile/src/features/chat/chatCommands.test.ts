// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  social: {
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    recallMessage: vi.fn(),
    hideMessageForActor: vi.fn(),
    moderateMessage: vi.fn(),
    setMessageReaction: vi.fn(),
    setMessagePinned: vi.fn(),
    updateGroupConversation: vi.fn(),
    addGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    updateGroupMemberAuthority: vi.fn(),
    transferGroupOwnership: vi.fn(),
    leaveGroup: vi.fn(),
    dissolveGroup: vi.fn(),
  },
}));
const native = vi.hoisted(() => ({
  forwardMessage: vi.fn(),
}));

vi.mock('../social/socialStore', () => ({
  useSocialStore: {
    getState: () => stores.social,
  },
}));

vi.mock('../../services/mobileCommands', async (original) => ({
  ...await original<typeof import('../../services/mobileCommands')>(),
  messagingForwardMessage: native.forwardMessage,
}));

import {
  dispatchEditMessage,
  dispatchForwardMessage,
  dispatchHideMessageForMe,
  dispatchModerateMessage,
  dispatchGroupDissolve,
  dispatchGroupInviteMember,
  dispatchGroupLeave,
  dispatchGroupRemoveMember,
  dispatchGroupTransferOwnership,
  dispatchGroupUpdate,
  dispatchGroupUpdateMember,
  dispatchMessagePin,
  dispatchMessageReaction,
  dispatchRecallMessage,
  dispatchSendMessage,
} from './chatCommands';
import type { MobileAuthSession } from '../auth/authSession';

const session: MobileAuthSession = {
  stationPeerId: 'station-1',
  stationUrl: 'https://station.example',
  sessionId: 'session-1',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('Chat command dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves reply and thread context for friend sends', async () => {
    const context = {
      replyToMessageId: 'message-parent',
      threadRootMessageId: 'message-root',
    };
    stores.social.sendMessage.mockResolvedValue({ state: 'pending' });

    await dispatchSendMessage('friend-1', 'friend reply', [], context);

    expect(stores.social.sendMessage).toHaveBeenCalledWith(
      'friend-1',
      'friend reply',
      [],
      context,
    );
  });

  it('routes reaction add/remove through the social store', async () => {
    await dispatchMessageReaction(
      'friend',
      'friend-1',
      'message-1',
      '\u{1F44D}',
      false,
      'message-root',
    );

    expect(stores.social.setMessageReaction).toHaveBeenCalledWith(
      'friend-1',
      'message-1',
      '\u{1F44D}',
      false,
      'message-root',
    );
  });

  it('routes pin and unpin through the social store', async () => {
    await dispatchMessagePin(
      'friend',
      'friend-1',
      'message-1',
      false,
    );

    expect(stores.social.setMessagePinned).toHaveBeenCalledWith(
      'friend-1',
      'message-1',
      false,
      undefined,
    );
  });

  it('returns Messaging Engine command projections for edit and recall', async () => {
    const friendEdit = {
      commandId: 'friend-edit',
      messageId: 'message-1',
      attachmentIds: [],
      state: 'pending',
    };
    const friendRecall = {
      commandId: 'friend-recall',
      messageId: 'message-3',
      attachmentIds: [],
      state: 'pending',
    };
    stores.social.editMessage.mockResolvedValue(friendEdit);
    stores.social.recallMessage.mockResolvedValue(friendRecall);

    await expect(dispatchEditMessage(
      'friend-1',
      'message-1',
      'edited',
    )).resolves.toBe(friendEdit);
    await expect(dispatchRecallMessage(
      'friend-1',
      'message-3',
    )).resolves.toBe(friendRecall);
  });

  it('keeps forward and actor-hide as distinct native commands', async () => {
    const pending = {
      commandId: 'command-1',
      messageId: 'message-1',
      attachmentIds: [],
      state: 'pending',
    };
    native.forwardMessage.mockResolvedValue(pending);
    stores.social.hideMessageForActor.mockResolvedValue(pending);

    await dispatchForwardMessage(
      session,
      'friend',
      'source-conversation',
      'message-1',
      'destination-conversation',
    );
    await dispatchHideMessageForMe(
      'friend',
      'source-conversation',
      'message-1',
    );

    expect(native.forwardMessage).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      admissionDomain: 'social',
      sourceConversationId: 'source-conversation',
      sourceMessageId: 'message-1',
      destinationConversationId: 'destination-conversation',
    });
    expect(stores.social.hideMessageForActor).toHaveBeenCalledWith(
      'source-conversation',
      'message-1',
    );
  });

  it('routes Group lifecycle and moderation through the unified social store', async () => {
    await dispatchGroupUpdate('group-1', { name: 'Core' });
    await dispatchGroupInviteMember('group-1', 'ptid:bob');
    await dispatchGroupRemoveMember('group-1', 'ptid:carol');
    await dispatchGroupUpdateMember('group-1', 'ptid:bob', { role: 'admin' });
    await dispatchGroupTransferOwnership('group-1', 'ptid:bob');
    await dispatchModerateMessage('group-1', 'message-1', 'group_policy_violation');
    await dispatchGroupLeave('group-1');
    await dispatchGroupDissolve('group-1');

    expect(stores.social.updateGroupConversation).toHaveBeenCalledWith(
      'group-1',
      { name: 'Core' },
    );
    expect(stores.social.addGroupMember).toHaveBeenCalledWith('group-1', 'ptid:bob');
    expect(stores.social.removeGroupMember).toHaveBeenCalledWith('group-1', 'ptid:carol');
    expect(stores.social.updateGroupMemberAuthority).toHaveBeenCalledWith(
      'group-1',
      'ptid:bob',
      { role: 'admin' },
    );
    expect(stores.social.transferGroupOwnership).toHaveBeenCalledWith(
      'group-1',
      'ptid:bob',
    );
    expect(stores.social.moderateMessage).toHaveBeenCalledWith(
      'group-1',
      'message-1',
      'group_policy_violation',
    );
    expect(stores.social.leaveGroup).toHaveBeenCalledWith('group-1');
    expect(stores.social.dissolveGroup).toHaveBeenCalledWith('group-1');
  });
});
