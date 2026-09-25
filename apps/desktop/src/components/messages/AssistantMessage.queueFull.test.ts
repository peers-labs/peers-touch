import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assistantMessageSource = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);
const queueTraySource = readFileSync(
  new URL('../chat/TurnQueueTray.tsx', import.meta.url),
  'utf8',
);

describe('queue-full component recovery wiring', () => {
  it('refreshes and focuses the existing queue without resending', () => {
    const actionStart = assistantMessageSource.indexOf(
      "if (message.resolution!.type === 'editQueue')",
    );
    const actionEnd = assistantMessageSource.indexOf(
      "if (message.resolution!.type === 'selectRuntime')",
      actionStart,
    );
    const actionBranch = assistantMessageSource.slice(actionStart, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(actionBranch).toContain('handleEditQueue()');
    expect(actionBranch).not.toContain('handleRetry(');
    expect(actionBranch).not.toContain('sendMessage(');
  });

  it('exposes a focusable queue editing surface', () => {
    expect(assistantMessageSource).toContain("'edit-queue'");
    expect(assistantMessageSource).toContain('syncTurnQueue(resolution.conversationId)');
    expect(assistantMessageSource).toContain(
      "document.querySelectorAll<HTMLElement>('[data-pt-agent-turn-queue]')",
    );
    expect(assistantMessageSource).toContain(
      'candidate.dataset.ptAgentTurnQueue === resolution.conversationId',
    );
    expect(assistantMessageSource).not.toContain('requestAnimationFrame');
    expect(queueTraySource).toContain(
      'data-pt-agent-turn-queue={currentSessionKey}',
    );
    expect(queueTraySource).toContain('tabIndex={-1}');
  });
});
