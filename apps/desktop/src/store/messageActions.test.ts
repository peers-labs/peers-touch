import { describe, expect, it, vi } from 'vitest';
import { buildMessageActions } from '../components/messages/actions/registry';
import type { MessageActionContext } from '../components/messages/actions/types';
import type { ChatMessage } from '../store/chat';

function createContext(overrides: Partial<MessageActionContext> = {}): MessageActionContext {
  const noop = vi.fn();
  return {
    message: { id: 'msg-1', role: 'assistant', content: 'Hello', timestamp: Date.now() } as ChatMessage,
    isStreaming: false,
    isCurrentSession: true,
    operation: undefined,
    onCopy: noop,
    onEdit: noop,
    onDelete: noop,
    onRegenerate: noop,
    onRetry: noop,
    onRetryRecovery: noop,
    onReloadSnapshot: noop,
    onBranch: noop,
    onContinue: noop,
    onDeleteAndRegenerate: noop,
    onTranslate: noop,
    onThread: noop,
    onReadAloud: noop,
    onExport: noop,
    onForward: noop,
    ...overrides,
  };
}

describe('message action registry', () => {
  it('returns empty actions during streaming', () => {
    const ctx = createContext({ message: { id: 'msg-1', role: 'assistant', content: '', timestamp: Date.now(), loading: true } as ChatMessage });
    const { primary, menu } = buildMessageActions(ctx);
    expect(primary).toHaveLength(0);
    expect(menu).toHaveLength(0);
  });

  it('returns copy + regenerate + read aloud for completed assistant message', () => {
    const ctx = createContext();
    const { primary, menu } = buildMessageActions(ctx);
    expect(primary.map((a) => a.key)).toEqual(['copy', 'regenerate', 'readAloud']);
    expect(menu.map((a) => a.key)).not.toContain('regenerate');
    expect(menu.map((a) => a.key)).not.toContain('edit');
    expect(menu.map((a) => a.key)).toContain('branch');
    expect(menu.map((a) => a.key)).toContain('continue');
    expect(menu.map((a) => a.key)).toContain('delete');
  });

  it('returns retry + delete for error assistant message', () => {
    const ctx = createContext({
      message: { id: 'msg-1', role: 'assistant', content: '', error: 'fail', timestamp: Date.now() } as ChatMessage,
    });
    const { primary } = buildMessageActions(ctx);
    expect(primary.map((a) => a.key)).toEqual(['retry', 'delete']);
  });

  it('does not retry a non-retryable typed error', () => {
    const onDelete = vi.fn();
    const ctx = createContext({
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        error: 'agent.errors.contextOverflow',
        typedError: {
          error: 'agent.errors.contextOverflow',
          error_type: 'CONTEXT_OVERFLOW',
          locale_key: 'agent.errors.contextOverflow',
          retryable: false,
          terminal: true,
          details: {
            limit_tokens: '128',
            actual_tokens: '129',
          },
        },
        timestamp: Date.now(),
      } as ChatMessage,
      onDelete,
    });

    const { primary, menu } = buildMessageActions(ctx);

    expect(primary.map((action) => action.key)).toEqual(['delete']);
    expect(menu.map((action) => action.key)).toEqual(['copy']);
    primary[0]?.onClick();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('exposes retry and durable reload when recovery failed', () => {
    const ctx = createContext({
      message: {
        id: 'msg-1',
        role: 'assistant',
        content: 'Partial',
        error: 'chat.agentTurnRecovery.recoveryFailed',
        timestamp: Date.now(),
        turnId: 'turn-1',
      } as ChatMessage,
      operation: {
        id: 'op-1',
        sessionKey: 'conversation-1',
        type: 'sendMessage',
        status: 'running',
        runState: 'recovery_failed',
        assistantMessageId: 'msg-1',
        abortController: new AbortController(),
        startedAt: Date.now(),
        turnId: 'turn-1',
      },
    });

    const { primary } = buildMessageActions(ctx);

    expect(primary.map((action) => action.key)).toEqual([
      'retryRecovery',
      'reloadSnapshot',
    ]);
  });

  it('returns copy + edit for user message', () => {
    const ctx = createContext({
      message: { id: 'msg-1', role: 'user', content: 'Hi', timestamp: Date.now() } as ChatMessage,
    });
    const { primary, menu } = buildMessageActions(ctx);
    expect(primary.map((a) => a.key)).toEqual(['copy', 'edit']);
    expect(menu.map((a) => a.key)).toContain('regenerate');
    expect(menu.map((a) => a.key)).toContain('delete');
  });

  it('calls the correct handler when action.onClick is invoked', () => {
    const onCopy = vi.fn();
    const ctx = createContext({ onCopy });
    const { primary } = buildMessageActions(ctx);
    const copyAction = primary.find((a) => a.key === 'copy');
    copyAction?.onClick();
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
