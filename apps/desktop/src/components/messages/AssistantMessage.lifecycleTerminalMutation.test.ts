import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('lifecycle terminal-mutation recovery wiring', () => {
  it('opens the matching immutable turn result from a non-danger action', () => {
    const handlerStart = source.indexOf('const handleOpenResult');
    const handlerEnd = source.indexOf('const handleOpenOriginal', handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const actionStart = source.indexOf(
      "if (message.resolution!.type === 'openResult')",
    );
    const actionEnd = source.indexOf(
      "if (message.resolution!.type === 'editQueue')",
      actionStart,
    );
    const action = source.slice(actionStart, actionEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handler).toContain('resolution.turnId !== message.turnId');
    expect(handler).toContain(
      'resolution.terminalStatus !== message.terminalStatus',
    );
    expect(handler).toContain("'[data-pt-agent-message-id]'");
    expect(handler).toContain(
      'candidate.dataset.ptAgentMessageId === message.id',
    );
    expect(handler).toContain('result.focus({ preventScroll: true })');
    expect(handler).not.toContain('openTurnDetails(');
    expect(action).toContain('handleOpenResult()');
    expect(source).toContain("'open-result'");
    expect(source).toContain(
      'data-pt-agent-error-terminal-status={message.typedError?.details.terminal_status}',
    );
    expect(source).toContain(
      "message.resolution.type !== 'openResult'",
    );
  });
});
