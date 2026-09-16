import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  findRetiredInlineReferences,
  hashInlineReference,
  removeRejectedInlineReferences,
} from './invalidReferenceRecovery';

describe('invalid inline reference recovery', () => {
  it('parses only the retired explicit reference syntax', () => {
    const draft = [
      '@Agent ask @reviewer about @difference and @stagedWork, then inspect',
      '@file:src/main.ts:10-20',
      '@folder:src/components',
      '@url:https://example.test/context',
      '@diff',
      '@staged',
      '@git:3',
      '@file:',
    ].join(' ');

    expect(findRetiredInlineReferences(draft).map(({ kind, raw }) => ({
      kind,
      raw,
    }))).toEqual([
      { kind: 'file', raw: '@file:src/main.ts:10-20' },
      { kind: 'folder', raw: '@folder:src/components' },
      { kind: 'url', raw: '@url:https://example.test/context' },
      { kind: 'diff', raw: '@diff' },
      { kind: 'staged', raw: '@staged' },
      { kind: 'git', raw: '@git:3' },
      { kind: 'file', raw: '@file:' },
    ]);
  });

  it('hashes the exact matched token as lowercase SHA-256', async () => {
    await expect(hashInlineReference('@file:src/main.ts')).resolves.toBe(
      '569e47e20957d2e4fcfc739d827258d4974831da382d3a17b4168e5c55330c4f',
    );
  });

  it('removes every exact hash match and preserves all other draft text', async () => {
    const rejectedToken = '@file:src/main.ts';
    const rejectedHash = await hashInlineReference(rejectedToken);
    const draft =
      `Ask @Agent about ${rejectedToken} and @file:src/other.ts.\n`
      + `${rejectedToken} remains duplicated.`;

    await expect(removeRejectedInlineReferences(
      draft,
      'file',
      rejectedHash,
    )).resolves.toEqual({
      draft:
        'Ask @Agent about and @file:src/other.ts.\n'
        + 'remains duplicated.',
      removedCount: 2,
    });
  });

  it('does not remove a token for another kind or a non-lowercase hash', async () => {
    const draft = '@file:src/main.ts @Agent';
    const hash = await hashInlineReference('@file:src/main.ts');

    await expect(removeRejectedInlineReferences(draft, 'folder', hash))
      .resolves.toEqual({ draft, removedCount: 0 });
    await expect(removeRejectedInlineReferences(draft, 'file', hash.toUpperCase()))
      .resolves.toEqual({ draft, removedCount: 0 });
  });

  it('wires the message action to a composer-owned local removal intent', () => {
    const chatInputSource = readFileSync(
      new URL('../ChatInput.tsx', import.meta.url),
      'utf8',
    );
    const assistantMessageSource = readFileSync(
      new URL('../messages/AssistantMessage.tsx', import.meta.url),
      'utf8',
    );

    expect(chatInputSource).toContain('composerReferenceRemoval');
    expect(chatInputSource).toContain('removeRejectedInlineReferences(');
    expect(chatInputSource).toContain('textareaRef.current?.focus()');
    expect(assistantMessageSource).toContain(
      "message.resolution!.type === 'removeReference'",
    );
    expect(assistantMessageSource).toContain('requestComposerReferenceRemoval(');
  });
});
