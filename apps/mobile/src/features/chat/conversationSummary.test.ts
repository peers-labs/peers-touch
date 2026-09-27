import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import { selectConversations, useSocialStore } from '../social/socialStore';
import { selectGroupConversations, useGroupStore } from '../group/groupStore';
import { projectGroupConversations } from '../group/groupProjection';
import { createGroupGateway } from '../../services/gateways';
import {
  messagingCommandStatus,
  messagingConversationSummary,
  messagingListConversations,
  messagingListMessages,
  messagingSendMessage,
  messagingSubmitReadCursor,
  type MessagingConversationProjection,
  type MessagingConversationSummary,
  type MessagingMessageProjection,
} from '../../services/mobileCommands';
import {
  conversationPreview,
  conversationSearchText,
  conversationUpdatedAt,
  type MobileConversation,
} from './chatSelectors';
import type { ChatMessageCommandOutcomes } from './messageCommandState';
import {
  friendSessionFromMessaging,
  groupFromMessaging,
  messageDeliveryDisplayState,
} from './messagingProjectionAdapters';

// Unit-only command seam. No runtime or native communication is exercised.
vi.mock('../../services/mobileCommands', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/mobileCommands')>(),
  messagingCommandStatus: vi.fn(),
  messagingConversationSummary: vi.fn(),
  messagingListConversations: vi.fn(),
  messagingListMessages: vi.fn(),
  messagingSendMessage: vi.fn(),
  messagingSubmitReadCursor: vi.fn(),
}));

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  deviceId: 'device-a',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};

function conversation(id: string, kind: number): MessagingConversationProjection {
  return {
    conversationId: id, kind, name: id, ownerPtid: 'ptid:alice',
    authorityStationId: 'station-a', federationId: 'fed-a',
    memberPtids: ['ptid:alice', 'ptid:bob'], members: [],
    membershipEpoch: 1, mlsEpoch: 1,
    active: true, updatedAtUnixMs: 1000,
  };
}

function message(id: string, overrides: Partial<MessagingMessageProjection> = {}): MessagingMessageProjection {
  return {
    messageId: id, senderPtid: 'ptid:bob', senderDeviceId: 'device-b',
    plaintext: id, attachments: [], state: 'accepted',
    timestampUnixMs: 2000, eventSequence: 2, retracted: false, moderated: false,
    reactions: [], readByPtids: [], ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe.each(['friend', 'group'] as const)('%s conversation summaries', (kind) => {
  const kindNumber = kind === 'friend' ? 1 : 2;
  const store = kind === 'friend' ? useSocialStore : useGroupStore;
  const rows = ['first', 'second', 'never-opened'].map((id) => conversation(id, kindNumber));

  function seedRows(next = rows) {
    if (kind === 'friend') {
      useSocialStore.setState({ sessions: next.map((row) => friendSessionFromMessaging(row, session.actorRef.ptid)) });
    } else {
      useGroupStore.setState({ groups: next.map((row) => groupFromMessaging(row)) });
    }
  }

  function active(id: string | null) {
    if (kind === 'friend') useSocialStore.setState({ activeSessionUlid: id });
    else useGroupStore.setState({ activeGroupUlid: id });
  }

  function projection(id = 'first'): MobileConversation {
    if (kind === 'friend') {
      return {
        kind: 'friend' as const, key: `friend:${id}`,
        conversation: selectConversations(useSocialStore.getState()).find((row) => row.session.ulid === id)!,
      };
    }
    return {
      kind: 'group' as const, key: `group:${id}`,
      conversation: selectGroupConversations(useGroupStore.getState()).find((row) => row.group.ulid === id)!,
    };
  }

  function refreshSummary() {
    return kind === 'friend'
      ? useSocialStore.getState().refreshSessions()
      : useGroupStore.getState().refreshUnreadCounts();
  }

  function refreshList() {
    return kind === 'friend'
      ? useSocialStore.getState().refreshSessions()
      : useGroupStore.getState().refreshGroups();
  }

  function snapshot() {
    return kind === 'friend' ? useSocialStore.getState().sessions : useGroupStore.getState().groups;
  }

  function replaceAccount(next: MobileAuthSession) {
    store.getState().bindSession(null);
    if (kind === 'friend') {
      useSocialStore.setState({
        authSession: next, sessionKey: mobileAuthScopeKey(next), currentUserPtid: next.actorRef.ptid,
      });
    } else {
      useGroupStore.setState({
        authSession: next, sessionKey: mobileAuthScopeKey(next), gateway: createGroupGateway(next),
      });
    }
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    useSocialStore.getState().bindSession(null);
    useGroupStore.getState().bindSession(null);
    useSocialStore.setState(useSocialStore.getInitialState(), true);
    useGroupStore.setState(useGroupStore.getInitialState(), true);
    useSocialStore.setState({
      authSession: session, sessionKey: mobileAuthScopeKey(session), currentUserPtid: session.actorRef.ptid,
      refreshFriendRequests: vi.fn(async () => undefined),
      refreshBlockedUsers: vi.fn(async () => undefined),
      refreshConversationSettings: vi.fn(async () => undefined),
      refreshNotifications: vi.fn(async () => undefined),
      loadConversationSettings: vi.fn(async () => undefined),
    });
    const gateway = createGroupGateway(session);
    vi.spyOn(gateway, 'getMySettings').mockResolvedValue({
      ok: true, data: {
        isMuted: false, isPinned: false, myNickname: '', showMemberNickname: false,
        alertEnabled: true, background: 'default', clearedAt: 0,
      },
    });
    vi.spyOn(gateway, 'leaveGroup').mockResolvedValue({ ok: true, data: {} });
    vi.spyOn(gateway, 'dissolveGroup').mockResolvedValue({ ok: true, data: {} });
    useGroupStore.setState({
      authSession: session, sessionKey: mobileAuthScopeKey(session), gateway,
      loadMembers: vi.fn(async () => undefined),
      loadSettings: vi.fn(async () => undefined),
    });
    vi.mocked(messagingListConversations).mockResolvedValue(rows);
    vi.mocked(messagingConversationSummary).mockImplementation(async ({ conversationId }) => ({
      lastMessage: message(`${conversationId}-summary`), unreadCount: 7,
    }));
    vi.mocked(messagingListMessages).mockImplementation(async ({ conversationId }) => [
      message(`${conversationId}-loaded`),
    ]);
    vi.mocked(messagingSubmitReadCursor).mockResolvedValue({ submitted: true });
    vi.mocked(messagingSendMessage).mockResolvedValue({
      messageId: 'pending-send', commandId: 'send-command', attachmentIds: [], state: 'pending',
    });
    seedRows();
  });

  afterEach(() => {
    useSocialStore.getState().bindSession(null);
    useGroupStore.getState().bindSession(null);
    vi.restoreAllMocks();
  });

  it('bootstraps lists with summaries and never hydrates unopened histories', async () => {
    seedRows([]);
    vi.mocked(messagingListConversations).mockResolvedValue([
      ...rows, conversation('other-kind', kindNumber === 1 ? 2 : 1),
      { ...conversation('inactive', kindNumber), active: false },
    ]);
    await store.getState().reconcile();
    expect(messagingConversationSummary).toHaveBeenCalledTimes(3);
    expect(messagingConversationSummary).toHaveBeenCalledWith({
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      deviceId: 'device-a',
      lifecycleGeneration: 1,
      conversationId: 'first',
    });
    expect(messagingListMessages).not.toHaveBeenCalled();
    expect(messagingSubmitReadCursor).not.toHaveBeenCalled();
    expect(store.getState().messages).toEqual({});
    expect(projection().conversation.unread).toBe(7);
    expect(projection().conversation.lastMessage?.content).toBe('first-summary');
  });

  it('uses pending summary metadata and attachments without loading history', async () => {
    vi.mocked(messagingConversationSummary).mockResolvedValue({
      lastMessage: message('pending-send', {
        senderPtid: 'ptid:alice', state: 'pending', eventSequence: undefined,
        plaintext: '', timestampUnixMs: 9000,
        attachments: [{
          attachmentId: 'stage-a',
          filename: 'pending.txt',
          mimeType: 'text/plain',
          plaintextSize: 8,
          contentKind: 1,
          durationMs: 0,
        }],
      }),
      unreadCount: 4,
    });
    await refreshSummary();
    const result = projection();
    expect(conversationPreview(result, (key) => key)).toBe('pending.txt');
    expect(conversationSearchText(result)).toContain('pending.txt');
    expect(conversationUpdatedAt(result)).toBe(9000);
    expect(messageDeliveryDisplayState(result.conversation.lastMessage!)).toBe('sending');
    expect(result.conversation.unread).toBe(4);
    expect(store.getState().messages).toEqual({});
  });

  it('keeps loaded histories intact while a newer summary owns the preview', async () => {
    await store.getState().loadMessages('first');
    const history = store.getState().messages;
    active('first');
    vi.mocked(messagingListMessages).mockClear();
    await refreshSummary();
    expect(store.getState().messages).toBe(history);
    expect(projection().conversation.lastMessage?.content).toBe('first-summary');
    expect(projection().conversation.unread).toBe(0);
    expect(messagingListMessages).not.toHaveBeenCalled();
    expect(messagingSubmitReadCursor).not.toHaveBeenCalled();
    if (kind === 'group') {
      // Contacts still supplies its history slice; it must observe the same summary.
      expect(projectGroupConversations(useGroupStore.getState())[0].lastMessage?.content)
        .toBe('first-summary');
    }
  });

  it('clears an empty summary instead of falling back to the loaded tail', async () => {
    await store.getState().loadMessages('first');
    const history = store.getState().messages;
    vi.mocked(messagingConversationSummary).mockResolvedValue({ lastMessage: null, unreadCount: 0 });
    await refreshSummary();
    expect(projection().conversation.lastMessage).toBeUndefined();
    expect(conversationPreview(projection(), (key) => key)).toBe('mobile.chat.noPreview');
    expect(store.getState().messages).toBe(history);
  });

  it('preserves the entire valid summary snapshot when one summary fails', async () => {
    await refreshSummary();
    const previous = snapshot();
    const unread = useGroupStore.getState().unreadCounts;
    vi.mocked(messagingConversationSummary).mockImplementation(async ({ conversationId }) => {
      if (conversationId === 'second') throw new Error('summary-unavailable');
      return { lastMessage: message('unpublished'), unreadCount: 99 };
    });
    await expect(refreshSummary()).rejects.toThrow('summary-unavailable');
    expect(snapshot()).toBe(previous);
    expect(useGroupStore.getState().unreadCounts).toBe(unread);
    expect(projection().conversation.lastMessage?.content).toBe('first-summary');
  });

  it.each(['resolve', 'reject'] as const)('fences a stale account summary %s', async (finish) => {
    const pending = deferred<MessagingConversationSummary>();
    vi.mocked(messagingConversationSummary).mockReturnValue(pending.promise);
    const old = refreshSummary();
    await vi.waitFor(() => expect(messagingConversationSummary).toHaveBeenCalledTimes(3));
    replaceAccount({ ...session, actorRef: { ptid: 'ptid:carol' } });
    const replacement = store.getState();
    if (finish === 'resolve') pending.resolve({ lastMessage: message('old-account'), unreadCount: 100 });
    else pending.reject(new Error('old-account-failure'));
    await old;
    expect(store.getState()).toBe(replacement);
    expect(messagingListMessages).not.toHaveBeenCalled();
  });

  it('ignores an old list before starting any summary or settings reads', async () => {
    const pending = deferred<MessagingConversationProjection[]>();
    vi.mocked(messagingListConversations).mockReturnValueOnce(pending.promise);
    const old = refreshList();
    replaceAccount({ ...session, stationPeerId: 'station-b' });
    const replacement = store.getState();
    pending.resolve(rows);
    await old;
    expect(store.getState()).toBe(replacement);
    expect(messagingConversationSummary).not.toHaveBeenCalled();
  });

  it('does not let an older list overwrite a newer refresh', async () => {
    const pending = deferred<MessagingConversationProjection[]>();
    vi.mocked(messagingListConversations).mockReturnValueOnce(pending.promise);
    const old = refreshList();
    vi.mocked(messagingListConversations).mockResolvedValue([conversation('replacement', kindNumber)]);
    await refreshList();
    const replacement = snapshot();
    pending.resolve(rows);
    await old;
    expect(snapshot()).toBe(replacement);
    expect(snapshot().map((row) => row.ulid)).toEqual(['replacement']);
  });

  it.each(['resolve', 'reject'] as const)('ignores an older summary refresh %s', async (finish) => {
    const pending = deferred<MessagingConversationSummary>();
    vi.mocked(messagingConversationSummary).mockReturnValue(pending.promise);
    const old = refreshSummary();
    await vi.waitFor(() => expect(messagingConversationSummary).toHaveBeenCalledTimes(3));
    vi.mocked(messagingConversationSummary).mockResolvedValue({
      lastMessage: message('new-refresh'), unreadCount: 2,
    });
    await refreshSummary();
    const latest = snapshot();
    if (finish === 'resolve') pending.resolve({ lastMessage: message('stale-refresh'), unreadCount: 99 });
    else pending.reject(new Error('stale-refresh-failure'));
    await old;
    expect(snapshot()).toBe(latest);
    expect(projection().conversation.lastMessage?.content).toBe('new-refresh');
    expect(projection().conversation.unread).toBe(2);
  });

  it('uses active selection at publication, without submitting a cursor from summaries', async () => {
    const pending = deferred<MessagingConversationSummary>();
    vi.mocked(messagingConversationSummary).mockReturnValue(pending.promise);
    const refresh = refreshSummary();
    await vi.waitFor(() => expect(messagingConversationSummary).toHaveBeenCalledTimes(3));
    active('first');
    pending.resolve({ lastMessage: message('newest'), unreadCount: 8 });
    await refresh;
    expect(projection('first').conversation.unread).toBe(0);
    expect(projection('second').conversation.unread).toBe(8);
    expect(messagingSubmitReadCursor).not.toHaveBeenCalled();
    await store.getState().loadMessages('first');
    expect(messagingSubmitReadCursor).toHaveBeenCalledExactlyOnceWith({
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      deviceId: 'device-a',
      lifecycleGeneration: 1,
      admissionDomain: kind === 'friend' ? 'social' : 'group',
      conversationId: 'first',
      lastReadSequence: 2,
    });
  });

  it('reconciles only active history and leaves materialized refresh to the Messaging owner', async () => {
    await store.getState().loadMessages('second');
    const retained = store.getState().messages.second;
    active('first');
    vi.mocked(messagingListMessages).mockClear();
    await store.getState().reconcile();
    expect(messagingListMessages).toHaveBeenCalledExactlyOnceWith({
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      deviceId: 'device-a',
      lifecycleGeneration: 1,
      conversationId: 'first',
    });
    expect(store.getState().messages.second).toBe(retained);
    expect(store.getState().messages).not.toHaveProperty('never-opened');
  });

  it('publishes immediate post-send previews from full-history readback', async () => {
    vi.mocked(messagingListMessages).mockResolvedValue([
      message('received'),
      message('already-read', { readByPtids: ['ptid:alice'] }),
      message('retracted', { retracted: true }),
      message('pending-send', { state: 'pending', senderPtid: 'ptid:alice', eventSequence: undefined }),
    ]);
    await store.getState().sendMessage('first', 'pending-send');
    expect(projection().conversation.lastMessage?.ulid).toBe('pending-send');
    expect(projection().conversation.unread).toBe(1);
    expect(messageDeliveryDisplayState(projection().conversation.lastMessage!)).toBe('sending');
    expect(messagingConversationSummary).not.toHaveBeenCalled();
  });

  it('does not let an older summary overwrite post-send history readback', async () => {
    const pending = deferred<MessagingConversationSummary>();
    vi.mocked(messagingConversationSummary).mockReturnValue(pending.promise);
    const refresh = refreshSummary();
    await vi.waitFor(() => expect(messagingConversationSummary).toHaveBeenCalledTimes(3));
    await store.getState().loadMessages('first');
    pending.resolve({ lastMessage: message('stale-summary'), unreadCount: 99 });
    await refresh;
    expect(projection().conversation.lastMessage?.content).toBe('first-loaded');
    expect(projection().conversation.unread).toBe(1);
    expect(projection('second').conversation.lastMessage?.content).toBe('stale-summary');
  });

  it('does not let an older history read overwrite a later summary preview', async () => {
    const pending = deferred<MessagingMessageProjection[]>();
    vi.mocked(messagingListMessages).mockReturnValueOnce(pending.promise);
    const load = store.getState().loadMessages('first');
    await refreshSummary();
    pending.resolve([message('old-history')]);
    await load;
    expect(store.getState().messages.first[0].content).toBe('old-history');
    expect(projection().conversation.lastMessage?.content).toBe('first-summary');
    expect(projection().conversation.unread).toBe(7);
  });

  it('keeps a newer pending summary when an older active history submits its read cursor', async () => {
    active('first');
    const history = deferred<MessagingMessageProjection[]>();
    const summary = deferred<MessagingConversationSummary>();
    vi.mocked(messagingListMessages).mockReturnValueOnce(history.promise);
    const load = store.getState().loadMessages('first');
    vi.mocked(messagingConversationSummary).mockReturnValue(summary.promise);
    const refresh = refreshSummary();
    await vi.waitFor(() => expect(messagingConversationSummary).toHaveBeenCalledTimes(3));
    history.resolve([message('old-active-history')]);
    await load;
    summary.resolve({ lastMessage: message('new-active-summary'), unreadCount: 8 });
    await refresh;
    expect(projection().conversation.lastMessage?.content).toBe('new-active-summary');
    expect(projection().conversation.unread).toBe(0);
    expect(messagingSubmitReadCursor).toHaveBeenCalledOnce();
  });

  it('does not restore unread from a summary started before active read and deselection', async () => {
    await store.getState().loadMessages('first');
    active('first');
    const summary = deferred<MessagingConversationSummary>();
    vi.mocked(messagingConversationSummary).mockReturnValue(summary.promise);
    const refresh = refreshSummary();
    await vi.waitFor(() => expect(messagingConversationSummary).toHaveBeenCalledTimes(3));
    if (kind === 'friend') await useSocialStore.getState().markActiveSessionRead('first');
    else await useGroupStore.getState().markRead('first');
    active(null);
    summary.resolve({ lastMessage: message('read-summary'), unreadCount: 8 });
    await refresh;
    expect(projection().conversation.lastMessage?.content).toBe('read-summary');
    expect(projection().conversation.unread).toBe(0);
  });

  it('fences overlapping history loads and preserves command readback', async () => {
    const pending = deferred<MessagingMessageProjection[]>();
    vi.mocked(messagingListMessages).mockReturnValueOnce(pending.promise);
    const old = store.getState().loadMessages('first');
    const messageCommandOutcomes: ChatMessageCommandOutcomes = {
      edited: {
        messageId: 'edited', commandId: 'edit-command', conversationId: 'first',
        kind: 'edit', state: 'pending', expectedContent: 'edited-content',
      },
    };
    if (kind === 'friend') useSocialStore.setState({ messageCommandOutcomes });
    else useGroupStore.setState({ messageCommandOutcomes });
    vi.mocked(messagingListMessages).mockResolvedValue([
      message('edited', { editedText: 'edited-content', editedAtUnixMs: 3000 }),
    ]);
    await store.getState().loadMessages('first');
    const latest = store.getState().messages;
    pending.resolve([message('old-history')]);
    await old;
    expect(store.getState().messages).toBe(latest);
    expect(store.getState().messageCommandOutcomes).toEqual({});
    expect(messagingCommandStatus).not.toHaveBeenCalled();
    expect(projection().conversation.lastMessage?.content).toBe('edited-content');
  });

  it('keeps valid history and preview when a history read fails', async () => {
    await store.getState().loadMessages('first');
    const previous = snapshot();
    const history = store.getState().messages;
    vi.mocked(messagingListMessages).mockRejectedValue(new Error('history-unavailable'));
    await expect(store.getState().loadMessages('first')).rejects.toThrow('history-unavailable');
    expect(snapshot()).toBe(previous);
    expect(store.getState().messages).toBe(history);
    expect(store.getState().error?.context.message).toBe('history-unavailable');
  });

  it.each(['resolve', 'reject'] as const)('does not publish history %s after reset and rebinding the same account', async (finish) => {
    const pending = deferred<MessagingMessageProjection[]>();
    vi.mocked(messagingListMessages).mockReturnValueOnce(pending.promise);
    const old = store.getState().loadMessages('first');
    replaceAccount(session);
    const replacement = store.getState();
    if (finish === 'resolve') pending.resolve([message('old-history')]);
    else pending.reject(new Error('old-history-failure'));
    await old;
    expect(store.getState()).toBe(replacement);
    expect(messagingSubmitReadCursor).not.toHaveBeenCalled();
  });

  it('stops a reconcile continuation when its account scope changes', async () => {
    const pending = deferred<MessagingConversationProjection[]>();
    vi.mocked(messagingListConversations).mockReturnValueOnce(pending.promise);
    const old = store.getState().reconcile();
    replaceAccount(session);
    const replacement = store.getState();
    pending.resolve(rows);
    await old;
    expect(store.getState()).toBe(replacement);
    expect(messagingConversationSummary).not.toHaveBeenCalled();
    expect(messagingListMessages).not.toHaveBeenCalled();
  });

  if (kind === 'group') {
    it('keeps pending leave visible, then removes state and fences reads after projection', async () => {
      await refreshSummary();
      const pending = deferred<MessagingConversationSummary>();
      vi.mocked(messagingConversationSummary).mockReturnValue(pending.promise);
      const refresh = refreshSummary();
      const pendingHistory = deferred<MessagingMessageProjection[]>();
      vi.mocked(messagingListMessages).mockReturnValueOnce(pendingHistory.promise);
      const load = store.getState().loadMessages('first');
      await useGroupStore.getState().leaveGroup('first');
      expect(useGroupStore.getState().groups.some((group) => group.ulid === 'first')).toBe(true);

      vi.mocked(messagingListConversations).mockResolvedValueOnce(
        rows.filter((conversation) => conversation.conversationId !== 'first'),
      );
      await useGroupStore.getState().refreshGroups();
      pending.resolve({ lastMessage: message('detached-summary'), unreadCount: 99 });
      pendingHistory.resolve([message('detached-history')]);
      await Promise.all([refresh, load]);
      expect(useGroupStore.getState().groups.some((group) => group.ulid === 'first')).toBe(false);
      expect(useGroupStore.getState().unreadCounts).not.toHaveProperty('first');
      expect(useGroupStore.getState().messages).not.toHaveProperty('first');
      expect(projection('second').conversation.lastMessage?.content).toBe('second-summary');
    });

    it('keeps dissolve pending until the Engine projection removes the group', async () => {
      await refreshSummary();
      await useGroupStore.getState().dissolveGroup('first');
      expect(useGroupStore.getState().groups.some((group) => group.ulid === 'first')).toBe(true);

      vi.mocked(messagingListConversations).mockResolvedValueOnce(
        rows.filter((conversation) => conversation.conversationId !== 'first'),
      );
      await useGroupStore.getState().refreshGroups();

      expect(useGroupStore.getState().groups.some((group) => group.ulid === 'first')).toBe(false);
      expect(useGroupStore.getState().unreadCounts).not.toHaveProperty('first');
      expect(useGroupStore.getState().messages).not.toHaveProperty('first');
      expect(projection('second').conversation.lastMessage?.content).toBe('second-summary');
    });

    it('fences summaries when a newer group list replaces their membership', async () => {
      const pending = deferred<MessagingConversationSummary>();
      vi.mocked(messagingConversationSummary).mockReturnValue(pending.promise);
      const old = refreshSummary();
      vi.mocked(messagingListConversations).mockResolvedValue([conversation('replacement', 2)]);
      await refreshList();
      const replacement = store.getState();
      pending.resolve({ lastMessage: message('old-list-summary'), unreadCount: 99 });
      await old;
      expect(store.getState()).toBe(replacement);
    });

    it('does not repopulate unread state when a read cursor completes after reset', async () => {
      await store.getState().loadMessages('first');
      const pending = deferred<{ submitted: boolean }>();
      vi.mocked(messagingSubmitReadCursor).mockReturnValueOnce(pending.promise);
      const read = useGroupStore.getState().markRead('first');
      replaceAccount(session);
      const replacement = store.getState();
      pending.resolve({ submitted: true });
      await read;
      expect(store.getState()).toBe(replacement);
    });
  }
});
