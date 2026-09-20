import { describe, expect, it, vi } from 'vitest';
import type { AuthSessionResponse } from '../../services/desktop_api';
import type {
  MessagingConversationProjection,
  MessagingProjection,
} from '../../services/im-service-contract';
import {
  createNativeAcceptanceBridge,
  type MessagingAcceptanceInteractionSnapshot,
} from './nativeBridge';

const ACTOR_PTID = 'ptid:v1:actor:alice';

function snapshot(): MessagingAcceptanceInteractionSnapshot {
  return {
    actorPtid: ACTOR_PTID,
    conversationId: 'conversation-1',
    messageId: 'message-1',
    projection: null,
    intent: null,
    outbox: null,
    directSessions: [],
    commandLedger: [],
    reactions: [],
    pins: [],
    readCursors: [],
    consumptionCount: 0,
    laneSequence: 0,
    consumerEpoch: 0,
  };
}

function logoutResponse(): AuthSessionResponse {
  return {
    command: 'auth_logout',
    status: 'logged_out',
    actor_ptid: null,
  };
}

function lifecycleDependencies() {
  return {
    createRestorableCommand: vi.fn(),
    prepareSubmittedCommand: vi.fn(),
    resumeMessagingLifecycle: vi.fn(),
  };
}

describe('nativeAcceptanceBridge', () => {
  it('logs out the matching Tauri-window actor before applying lifecycle cleanup', async () => {
    const calls: string[] = [];
    const bridge = createNativeAcceptanceBridge({
      ...lifecycleDependencies(),
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: () => calls.push('mark'),
      logoutWindowSession: async (actorPtid) => {
        expect(actorPtid).toBe(ACTOR_PTID);
        calls.push('logout');
        return logoutResponse();
      },
      completeLogoutLifecycle: async () => {
        calls.push('lifecycle');
      },
      readInteractionSnapshot: vi.fn(),
      readMessages: vi.fn(),
      readConversations: vi.fn(),
      readMemberSettings: vi.fn(),
      openAttachment: vi.fn(),
      identityState: vi.fn(),
    });

    await expect(bridge.logout({ actorPtid: ACTOR_PTID })).resolves.toEqual({
      actorPtid: ACTOR_PTID,
      status: 'logged_out',
    });
    expect(calls).toEqual(['mark', 'logout', 'lifecycle']);
  });

  it('fails closed before logout when the requested actor does not own the window', async () => {
    const logoutWindowSession = vi.fn();
    const bridge = createNativeAcceptanceBridge({
      ...lifecycleDependencies(),
      activeActorPtid: () => 'ptid:v1:actor:bob',
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession,
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot: vi.fn(),
      readMessages: vi.fn(),
      readConversations: vi.fn(),
      readMemberSettings: vi.fn(),
      openAttachment: vi.fn(),
      identityState: vi.fn(),
    });

    await expect(
      bridge.logout({ actorPtid: ACTOR_PTID }),
    ).rejects.toThrow('acceptance.chat.actorPtidMismatch');
    expect(logoutWindowSession).not.toHaveBeenCalled();
  });

  it('passes normalized evidence identity to the active Engine snapshot command', async () => {
    const evidence = snapshot();
    const readInteractionSnapshot = vi.fn().mockResolvedValue(evidence);
    const bridge = createNativeAcceptanceBridge({
      ...lifecycleDependencies(),
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot,
      readMessages: vi.fn(),
      readConversations: vi.fn(),
      readMemberSettings: vi.fn(),
      openAttachment: vi.fn(),
      identityState: vi.fn(),
    });

    await expect(
      bridge.engineInteractionSnapshot({
        actorPtid: ` ${ACTOR_PTID} `,
        conversationId: ' conversation-1 ',
        messageId: ' message-1 ',
        commandId: ' command-1 ',
      }),
    ).resolves.toBe(evidence);
    expect(readInteractionSnapshot).toHaveBeenCalledWith({
      actorPtid: ACTOR_PTID,
      conversationId: 'conversation-1',
      messageId: 'message-1',
      commandId: 'command-1',
    });
  });

  it('rejects incomplete snapshot identity without invoking Rust', async () => {
    const readInteractionSnapshot = vi.fn();
    const bridge = createNativeAcceptanceBridge({
      ...lifecycleDependencies(),
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot,
      readMessages: vi.fn(),
      readConversations: vi.fn(),
      readMemberSettings: vi.fn(),
      openAttachment: vi.fn(),
      identityState: vi.fn(),
    });

    await expect(
      bridge.engineInteractionSnapshot({
        actorPtid: ACTOR_PTID,
        conversationId: '',
        messageId: 'message-1',
      }),
    ).rejects.toThrow('acceptance.chat.conversationIdRequired');
    expect(readInteractionSnapshot).not.toHaveBeenCalled();
  });

  it('prepares an exact submitted command before resuming its lifecycle', async () => {
    const evidence = snapshot();
    const prepareSubmittedCommand = vi.fn().mockResolvedValue({
      actorPtid: ACTOR_PTID,
      snapshot: evidence,
    });
    const resumeMessagingLifecycle = vi.fn().mockResolvedValue({
      actorPtid: ACTOR_PTID,
      activated: true,
    });
    const bridge = createNativeAcceptanceBridge({
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot: vi.fn(),
      prepareSubmittedCommand,
      createRestorableCommand: vi.fn(),
      resumeMessagingLifecycle,
      readMessages: vi.fn(),
      readConversations: vi.fn(),
      readMemberSettings: vi.fn(),
      openAttachment: vi.fn(),
      identityState: vi.fn(),
    });

    await expect(
      bridge.prepareSubmittedCommand({
        actorPtid: ACTOR_PTID,
        conversationId: ' conversation-1 ',
        messageId: ' message-1 ',
        commandId: ' command-1 ',
      }),
    ).resolves.toEqual({ actorPtid: ACTOR_PTID, snapshot: evidence });
    expect(prepareSubmittedCommand).toHaveBeenCalledWith({
      actorPtid: ACTOR_PTID,
      conversationId: 'conversation-1',
      messageId: 'message-1',
      commandId: 'command-1',
    });
    await expect(
      bridge.resumeMessagingLifecycle({ actorPtid: ACTOR_PTID }),
    ).resolves.toEqual({ actorPtid: ACTOR_PTID, activated: true });
    expect(resumeMessagingLifecycle).toHaveBeenCalledWith(ACTOR_PTID);
  });

  it('creates a restorable command for a canonical actor and conversation', async () => {
    const evidence = snapshot();
    const createRestorableCommand = vi.fn().mockResolvedValue({
      actorPtid: ACTOR_PTID,
      conversationId: 'conversation-1',
      messageId: 'message-1',
      commandId: 'command-1',
      snapshot: evidence,
    });
    const bridge = createNativeAcceptanceBridge({
      ...lifecycleDependencies(),
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot: vi.fn(),
      createRestorableCommand,
      readMessages: vi.fn(),
      readConversations: vi.fn(),
      readMemberSettings: vi.fn(),
      openAttachment: vi.fn(),
      identityState: vi.fn(),
    });

    await expect(
      bridge.createRestorableCommand({
        actorPtid: ACTOR_PTID,
        conversationId: ' conversation-1 ',
        plaintext: ' recover me ',
      }),
    ).resolves.toMatchObject({
      messageId: 'message-1',
      commandId: 'command-1',
    });
    expect(createRestorableCommand).toHaveBeenCalledWith({
      actorPtid: ACTOR_PTID,
      conversationId: 'conversation-1',
      plaintext: 'recover me',
    });
  });

  it('routes bounded readbacks through the matching Tauri-window actor', async () => {
    const messages: MessagingProjection[] = [];
    const conversations: MessagingConversationProjection[] = [];
    const settings = {
      nickname: '',
      muted: true,
      alertEnabled: true,
      pinned: false,
      background: 'default',
      backgroundImage: '',
      clearedAtUnixMs: 0,
    };
    const bridge = createNativeAcceptanceBridge({
      ...lifecycleDependencies(),
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot: vi.fn(),
      readMessages: vi.fn().mockResolvedValue(messages),
      readConversations: vi.fn().mockResolvedValue(conversations),
      readMemberSettings: vi.fn().mockResolvedValue(settings),
      openAttachment: vi.fn().mockResolvedValue('/tmp/attachment'),
      identityState: vi.fn(),
    });

    await expect(bridge.engineMessages({
      actorPtid: ACTOR_PTID,
      conversationId: ' conversation-1 ',
    })).resolves.toEqual({ messages });
    await expect(bridge.engineConversations({
      actorPtid: ACTOR_PTID,
    })).resolves.toEqual({ conversations });
    await expect(bridge.conversationMemberSettings({
      actorPtid: ACTOR_PTID,
      conversationId: ' conversation-1 ',
    })).resolves.toEqual({ settings });
    await expect(bridge.openAttachment({
      actorPtid: ACTOR_PTID,
      attachmentId: ' attachment-1 ',
    })).resolves.toEqual({ localPath: '/tmp/attachment' });
  });

  it('reports the injected identity lifecycle without requiring an active actor', async () => {
    const identityState = {
      phase: 'accountGate',
      reason: 'revoked',
      authenticated: false,
      actorPtid: '',
    };
    const bridge = createNativeAcceptanceBridge({
      ...lifecycleDependencies(),
      activeActorPtid: () => null,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot: vi.fn(),
      readMessages: vi.fn(),
      readConversations: vi.fn(),
      readMemberSettings: vi.fn(),
      openAttachment: vi.fn(),
      identityState: () => identityState,
    });

    await expect(bridge.identityState()).resolves.toBe(identityState);
  });
});
