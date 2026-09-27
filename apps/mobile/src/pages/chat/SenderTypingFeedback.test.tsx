import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  IDLE_SENDER_TYPING_FEEDBACK,
  type SenderTypingRequest,
} from '../../features/chat/typingFeedbackState';
import { SenderTypingFeedback } from './SenderTypingFeedback';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

const REQUEST: SenderTypingRequest = {
  attempt: 1,
  conversationId: 'conversation-1',
  typing: true,
};

describe('SenderTypingFeedback', () => {
  it('does not reserve a status row while idle', () => {
    expect(renderToStaticMarkup(
      <SenderTypingFeedback
        feedback={IDLE_SENDER_TYPING_FEEDBACK}
        onRetry={() => undefined}
      />,
    )).toBe('');
  });

  it.each([
    ['waiting', 'mobile.chat.typing'],
    ['retrying', 'mobile.chat.commandRetrying'],
  ] as const)('announces %s progress', (phase, expectedCopy) => {
    const markup = renderToStaticMarkup(
      <SenderTypingFeedback
        feedback={{ phase, request: REQUEST }}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain(`data-sender-typing-state="${phase}"`);
    expect(markup).toContain('role="status"');
    expect(markup).toContain(expectedCopy);
  });

  it('renders failure as an alert with an explicit retry action', () => {
    const markup = renderToStaticMarkup(
      <SenderTypingFeedback
        feedback={{
          phase: 'failed',
          request: REQUEST,
          error: new Error('transport unavailable'),
        }}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain('data-sender-typing-state="failed"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('mobile.recovery.runtimeStatus.failed');
    expect(markup).toContain('common.action.retry');
  });
});
