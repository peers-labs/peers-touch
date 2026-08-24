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
