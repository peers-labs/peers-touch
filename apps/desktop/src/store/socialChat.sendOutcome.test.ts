import { describe, expect, it } from 'vitest';

import {
  conversationLocalStateForProfile,
  MessagingSendOutcomeError,
  requireQueuedMessagingSendOutcome,
  resolveReplyThreadRootUlid,
} from './socialChat';
import type { MessagingSendOutcome } from '../services/im-service-contract';

function outcome(
  state: MessagingSendOutcome['state'],
  attachmentIds = ['attachment-1'],
): MessagingSendOutcome {
  return {
    commandId: state === 'pending' ? 'command-1' : undefined,
    messageId: 'message-1',
    attachmentIds,
    attachmentCount: attachmentIds.length,
    state,
  };
}

describe('social chat send outcome boundary', () => {
  it('accepts only a count-conserving queued outcome', () => {
    expect(requireQueuedMessagingSendOutcome(outcome('pending'), 1)).toMatchObject({
      commandId: 'command-1',
      state: 'pending',
      attachmentCount: 1,
    });
  });

  it.each(['draft', 'attachment_failed'] as const)(
    'rejects %s before post-send success handling',
    (state) => {
      expect(() => requireQueuedMessagingSendOutcome(outcome(state), 1))
        .toThrowError(MessagingSendOutcomeError);
      try {
        requireQueuedMessagingSendOutcome(outcome(state), 1);
      } catch (error) {
        expect(error).toMatchObject({ code: 'not_queued', outcome: { state } });
      }
    },
  );

  it('rejects pending outcomes without a command identity', () => {
    expect(() => requireQueuedMessagingSendOutcome({
      ...outcome('pending'),
      commandId: undefined,
    }, 1)).toThrowError(expect.objectContaining({ code: 'missing_command_id' }));
  });

  it('rejects pending outcomes that violate attachment count conservation', () => {
    expect(() => requireQueuedMessagingSendOutcome(outcome('pending'), 2))
      .toThrowError(expect.objectContaining({ code: 'attachment_count_mismatch' }));
    expect(() => requireQueuedMessagingSendOutcome({
      ...outcome('pending'),
      attachmentCount: 2,
    }, 1)).toThrowError(expect.objectContaining({ code: 'attachment_count_mismatch' }));
  });
});

describe('social chat reply thread ownership', () => {
  const messages = [
    { ulid: 'root' },
    { ulid: 'nested-reply', threadRootUlid: 'root' },
  ];

  it('binds an inline root reply to the target message', () => {
    expect(resolveReplyThreadRootUlid(messages, 'root')).toBe('root');
  });

  it('preserves the existing root when replying to a nested message', () => {
    expect(resolveReplyThreadRootUlid(messages, 'nested-reply')).toBe('root');
  });

  it('prefers the explicit root supplied by a thread surface', () => {
    expect(resolveReplyThreadRootUlid(messages, 'nested-reply', 'explicit-root'))
      .toBe('explicit-root');
  });

  it('does not create a thread root for a non-reply message', () => {
    expect(resolveReplyThreadRootUlid(messages)).toBeUndefined();
  });
});

describe('social chat profile hydration', () => {
  const authoritativeState = {
    'group:group-1': {
      muted: true,
      sticky: true,
      background: 'paper' as const,
      backgroundImage: 'oss://self/background.png',
      clearedAt: 0,
    },
  };

  it('preserves the current Station projection when the profile identity is unchanged', () => {
    expect(conversationLocalStateForProfile(
      'ptid:self',
      'ptid:self',
      authoritativeState,
      {},
    )).toBe(authoritativeState);
  });

  it('loads actor-scoped persisted state when the profile identity changes', () => {
    const persistedState = {
      'group:group-2': {
        hidden: true,
        deletedMessageUlids: { 'message-1': true as const },
      },
    };

    expect(conversationLocalStateForProfile(
      'ptid:previous',
      'ptid:self',
      authoritativeState,
      persistedState,
    )).toBe(persistedState);
  });
});
