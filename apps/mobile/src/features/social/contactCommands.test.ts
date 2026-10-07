import { beforeEach, describe, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => {
  const state = {
    currentUserPtid: 'ptid:alice',
    friendRequests: [] as Array<{
      status: number;
      federationId: string;
      senderPtid: string;
      receiverPtid: string;
    }>,
    sessions: [] as Array<{ ulid: string }>,
    messagingConversations: [] as Array<{
      conversationId: string;
      description?: string;
    }>,
    openDirectConversation: vi.fn(async () => 'conversation-1'),
    acceptFriendRequest: vi.fn(async () => undefined),
    rejectFriendRequest: vi.fn(async () => undefined),
    sendFriendRequest: vi.fn(),
    createGroup: vi.fn(async () => ({
      conversationId: 'group-1',
      commandId: 'command-create',
      state: 'pending' as const,
    })),
    updateGroupConversation: vi.fn(async () => ({
      commandId: 'command-update',
      state: 'pending' as const,
    })),
  };
  return {
    state,
    wakeMessaging: vi.fn(async () => undefined),
  };
});

vi.mock('./socialStore', () => ({
  useSocialStore: {
    getState: () => ports.state,
  },
}));

vi.mock('../../runtimes/messagingRuntime', () => ({
  wakeActiveMessagingSession: ports.wakeMessaging,
}));

import {
  dispatchAcceptFriendRequest,
  dispatchCreateGroup,
  dispatchOpenContactChat,
} from './contactCommands';

describe('Contact command ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ports.state.sessions = [];
    ports.state.messagingConversations = [];
    ports.state.friendRequests = [];
    ports.wakeMessaging.mockImplementation(async () => undefined);
  });

  it('waits for Messaging-owned Direct projection before navigation', async () => {
    ports.wakeMessaging.mockImplementationOnce(async () => {
      ports.state.sessions = [{ ulid: 'conversation-1' }];
    });

    await expect(dispatchOpenContactChat('ptid:bob', 'federation-1'))
      .resolves.toBe('conversation-1');
    expect(ports.state.openDirectConversation).toHaveBeenCalledWith(
      'ptid:bob',
      'federation-1',
    );
    expect(ports.wakeMessaging).toHaveBeenCalledOnce();
  });

  it('keeps navigation pending when Messaging has not projected the Direct', async () => {
    await expect(dispatchOpenContactChat('ptid:bob', 'federation-1'))
      .rejects.toThrow('mobile.contacts.conversationPreparing');
  });

  it('wakes Messaging after a confirmed friend acceptance', async () => {
    await dispatchAcceptFriendRequest('request-1');
    expect(ports.state.acceptFriendRequest).toHaveBeenCalledWith('request-1');
    expect(ports.wakeMessaging).toHaveBeenCalledOnce();
  });

  it('applies the retained description after Messaging projects a new Group', async () => {
    ports.state.friendRequests = [{
      status: 2,
      federationId: 'federation-1',
      senderPtid: 'ptid:alice',
      receiverPtid: 'ptid:bob',
    }];
    ports.wakeMessaging.mockImplementationOnce(async () => {
      ports.state.messagingConversations = [{
        conversationId: 'group-1',
        description: '',
      }];
    });

    await dispatchCreateGroup({
      name: 'Group',
      description: 'Description',
      initialMemberPtids: ['ptid:bob'],
    });

    expect(ports.state.updateGroupConversation).toHaveBeenCalledWith(
      'group-1',
      { description: 'Description' },
    );
    expect(ports.wakeMessaging).toHaveBeenCalledTimes(2);
  });
});
