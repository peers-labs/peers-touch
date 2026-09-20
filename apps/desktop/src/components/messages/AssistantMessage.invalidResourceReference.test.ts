import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const assistantMessageSource = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);
const chatInputSource = readFileSync(
  new URL('../ChatInput.tsx', import.meta.url),
  'utf8',
);

describe('invalid resource-reference component recovery wiring', () => {
  it('requests the composer-owned picker without retrying or resending', () => {
    const actionStart = assistantMessageSource.indexOf(
      "if (message.resolution!.type === 'chooseResourceAgain')",
    );
    const actionEnd = assistantMessageSource.indexOf(
      "if (message.resolution!.type === 'removeReference')",
      actionStart,
    );
    const actionBranch = assistantMessageSource.slice(actionStart, actionEnd);

    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);
    expect(actionBranch).toContain('requestComposerResourceSelection(');
    expect(actionBranch).toContain('message.resolution!.resourceKind');
    expect(actionBranch).toContain('message.resolution!.resourceRefHash');
    expect(actionBranch).not.toContain('handleRetry(');
    expect(actionBranch).not.toContain('sendMessage(');
  });

  it('exposes stable recovery evidence and reuses the existing picker with focus restoration', () => {
    expect(assistantMessageSource).toContain(
      'data-pt-agent-error-resource-ref-hash=',
    );
    expect(assistantMessageSource).toContain("'choose-resource-again'");
    expect(chatInputSource).toContain('state.composerResourceSelection');
    expect(chatInputSource).toContain('fileInputRef.current?.click()');
    expect(chatInputSource).toContain(
      'requestAnimationFrame(() => textareaRef.current?.focus())',
    );
    expect(chatInputSource).toContain('data-pt-agent-attachment-input');
    expect(chatInputSource).toContain('data-pt-agent-resource-picker');
  });
});
