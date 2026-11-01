import { describe, expect, it } from 'vitest';

import {
  admitMessagingSendOutcome,
  conversationLocalStateForProfile,
  MessagingSendOutcomeError,
  resolveReplyThreadRootUlid,
} from './socialChat';
import type { MessagingSendOutcome } from '../services/im-service-contract';

function outcome(
  state: MessagingSendOutcome['state'],
  attachmentIds = ['attachment-1'],
): MessagingSendOutcome {
  return {
    admission: 'admitted',
    commandId: state === 'pending' ? 'command-1' : undefined,
    messageId: 'message-1',
    attachmentIds,
    attachmentCount: attachmentIds.length,
    state,
  };
}

describe('social chat MP-D33 send admission boundary', () => {
  it('admits a pending outcome with its command identity', () => {
    expect(admitMessagingSendOutcome(outcome('pending'), 1)).toMatchObject({
      commandId: 'command-1',
      state: 'pending',
      attachmentCount: 1,
    });
  });

  it('admits a deferred draft as a successful durable admission', () => {
    // Regression: a deferred draft used to throw and produced a failure toast
    // plus a composer-resident duplicate even though the message was durably
    // queued and would be sent by the lifecycle worker.
    expect(admitMessagingSendOutcome(outcome('draft'), 1)).toMatchObject({
      state: 'draft',
    });
  });

  it('rejects pending outcomes without a command identity', () => {
    expect(() => admitMessagingSendOutcome({
      ...outcome('pending'),
      commandId: undefined,
    }, 1)).toThrowError(MessagingSendOutcomeError);
  });

  it('rejects outcomes that violate attachment count conservation', () => {
    expect(() => admitMessagingSendOutcome(outcome('pending'), 2))
      .toThrowError(expect.objectContaining({ code: 'attachment_count_mismatch' }));
    expect(() => admitMessagingSendOutcome({
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
