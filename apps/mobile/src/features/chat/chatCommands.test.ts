// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = vi.hoisted(() => ({
  social: {
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    recallMessage: vi.fn(),
    hideMessageForActor: vi.fn(),
    setMessageReaction: vi.fn(),
    setMessagePinned: vi.fn(),
  },
  group: {
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    recallMessage: vi.fn(),
    hideMessageForActor: vi.fn(),
    moderateMessage: vi.fn(),
    setMessageReaction: vi.fn(),
    setMessagePinned: vi.fn(),
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

vi.mock('../group/groupStore', () => ({
  useGroupStore: {
    getState: () => stores.group,
  },
}));

vi.mock('../../services/mobileCommands', async (original) => ({
  ...await original<typeof import('../../services/mobileCommands')>(),
  messagingForwardMessage: native.forwardMessage,
}));

import {
  dispatchEditMessage,
  dispatchForwardMessage,
  dispatchGroupEditMessage,
  dispatchGroupRecallMessage,
  dispatchGroupSendMessage,
  dispatchHideMessageForMe,
  dispatchMessagePin,
  dispatchMessageReaction,
  dispatchModerateMessage,
  dispatchRecallMessage,
  dispatchSendMessage,
} from './chatCommands';
import type { MobileAuthSession } from '../auth/authSession';

const session: MobileAuthSession = {
  stationPeerId: 'station-1',
  stationUrl: 'https://station.example',
  sessionId: 'session-1',
  deviceId: 'device-1',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

describe('Chat command dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves reply and thread context for friend and group sends', async () => {
    const context = {
      replyToMessageId: 'message-parent',
      threadRootMessageId: 'message-root',
    };
    stores.social.sendMessage.mockResolvedValue({ state: 'pending' });
    stores.group.sendMessage.mockResolvedValue({ state: 'pending' });

    await dispatchSendMessage('friend-1', 'friend reply', [], context);
    await dispatchGroupSendMessage('group-1', 'group reply', [], context);

    expect(stores.social.sendMessage).toHaveBeenCalledWith(
      'friend-1',
      'friend reply',
      [],
      context,
    );
    expect(stores.group.sendMessage).toHaveBeenCalledWith(
      'group-1',
      'group reply',
      [],
      context,
    );
  });

  it('routes reaction add/remove through the matching conversation store', async () => {
    await dispatchMessageReaction(
      'friend',
      'friend-1',
      'message-1',
      '👍',
      false,
      'message-root',
    );
    await dispatchMessageReaction(
      'group',
      'group-1',
      'message-2',
      '👍',
      true,
      'message-root',
    );

    expect(stores.social.setMessageReaction).toHaveBeenCalledWith(
      'friend-1',
      'message-1',
      '👍',
      false,
      'message-root',
    );
    expect(stores.group.setMessageReaction).toHaveBeenCalledWith(
      'group-1',
      'message-2',
      '👍',
      true,
      'message-root',
    );
  });

  it('routes pin and unpin through the matching conversation store', async () => {
    await dispatchMessagePin(
      'friend',
      'friend-1',
      'message-1',
      false,
    );
    await dispatchMessagePin(
      'group',
      'group-1',
      'message-2',
      true,
      'message-root',
    );

    expect(stores.social.setMessagePinned).toHaveBeenCalledWith(
      'friend-1',
      'message-1',
      false,
      undefined,
    );
    expect(stores.group.setMessagePinned).toHaveBeenCalledWith(
      'group-1',
      'message-2',
      true,
      'message-root',
    );
  });

  it('returns Messaging Engine command projections for edit and recall', async () => {
    const friendEdit = {
      commandId: 'friend-edit',
      messageId: 'message-1',
      attachmentIds: [],
      state: 'pending',
    };
    const groupEdit = {
      commandId: 'group-edit',
      messageId: 'message-2',
      attachmentIds: [],
      state: 'pending',
    };
    const friendRecall = {
      commandId: 'friend-recall',
      messageId: 'message-3',
      attachmentIds: [],
      state: 'pending',
    };
    const groupRecall = {
      commandId: 'group-recall',
      messageId: 'message-4',
      attachmentIds: [],
      state: 'pending',
    };
    stores.social.editMessage.mockResolvedValue(friendEdit);
    stores.group.editMessage.mockResolvedValue(groupEdit);
    stores.social.recallMessage.mockResolvedValue(friendRecall);
    stores.group.recallMessage.mockResolvedValue(groupRecall);

    await expect(dispatchEditMessage(
      'friend-1',
      'message-1',
      'edited',
    )).resolves.toBe(friendEdit);
    await expect(dispatchGroupEditMessage(
      'group-1',
      'message-2',
      'edited',
    )).resolves.toBe(groupEdit);
    await expect(dispatchRecallMessage(
      'friend-1',
      'message-3',
    )).resolves.toBe(friendRecall);
    await expect(dispatchGroupRecallMessage(
      'group-1',
      'message-4',
    )).resolves.toBe(groupRecall);
  });

  it('keeps forward, actor-hide, and moderation as distinct native commands', async () => {
    const pending = {
      commandId: 'command-1',
      messageId: 'message-1',
      attachmentIds: [],
      state: 'pending',
    };
    native.forwardMessage.mockResolvedValue(pending);
    stores.social.hideMessageForActor.mockResolvedValue(pending);
    stores.group.moderateMessage.mockResolvedValue(pending);

    await dispatchForwardMessage(
      session,
      'group',
      'source-conversation',
      'message-1',
      'destination-conversation',
    );
    await dispatchHideMessageForMe(
      'friend',
      'source-conversation',
      'message-1',
    );
    await dispatchModerateMessage(
      'source-conversation',
      'message-1',
      'group_policy_violation',
    );

    expect(native.forwardMessage).toHaveBeenCalledWith({
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
      deviceId: 'device-1',
      lifecycleGeneration: 1,
      admissionDomain: 'group',
      sourceConversationId: 'source-conversation',
      sourceMessageId: 'message-1',
      destinationConversationId: 'destination-conversation',
    });
    expect(stores.social.hideMessageForActor).toHaveBeenCalledWith(
      'source-conversation',
      'message-1',
    );
    expect(stores.group.moderateMessage).toHaveBeenCalledWith(
      'source-conversation',
      'message-1',
      'group_policy_violation',
    );
  });
});
