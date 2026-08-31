import { describe, expect, it, vi } from 'vitest';
import type {
  AuthSessionResponse,
  MessagingAcceptanceInteractionSnapshot,
} from '../../services/desktop_api';
import { createNativeAcceptanceBridge } from './nativeBridge';

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

describe('nativeAcceptanceBridge', () => {
  it('logs out the matching Tauri-window actor before applying lifecycle cleanup', async () => {
    const calls: string[] = [];
    const bridge = createNativeAcceptanceBridge({
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
      activeActorPtid: () => 'ptid:v1:actor:bob',
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession,
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot: vi.fn(),
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
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot,
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
      activeActorPtid: () => ACTOR_PTID,
      markLocalIdentityAction: vi.fn(),
      logoutWindowSession: vi.fn(),
      completeLogoutLifecycle: vi.fn(),
      readInteractionSnapshot,
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
});
