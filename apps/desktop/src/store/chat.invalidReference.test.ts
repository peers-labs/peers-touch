import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from './chat';

describe('chat composer invalid-reference intent', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('publishes a local removal intent without replacing or focusing the draft', () => {
    useChatStore.getState().fillComposer('preserved draft');
    useChatStore.setState({ currentSessionKey: 'conversation-1' });
    const focusNonce = useChatStore.getState().composerFocusNonce;

    useChatStore.getState().requestComposerReferenceRemoval(
      'file',
      'a'.repeat(64),
    );

    expect(useChatStore.getState().composerReferenceRemoval).toEqual({
      sessionKey: 'conversation-1',
      referenceKind: 'file',
      referenceHash: 'a'.repeat(64),
      nonce: expect.any(Number),
    });
    expect(useChatStore.getState().composerFill).toEqual({
      text: 'preserved draft',
      nonce: expect.any(Number),
    });
    expect(useChatStore.getState().composerFocusNonce).toBe(focusNonce);
  });

  it('clears only the matching request generation', () => {
    useChatStore.getState().requestComposerReferenceRemoval(
      'url',
      'b'.repeat(64),
    );
    const first = useChatStore.getState().composerReferenceRemoval;

    useChatStore.getState().requestComposerReferenceRemoval(
      'git',
      'c'.repeat(64),
    );
    const second = useChatStore.getState().composerReferenceRemoval;

    expect(first).not.toBeNull();
    expect(second?.nonce).toBeGreaterThan(first?.nonce ?? 0);

    useChatStore.getState().consumeComposerReferenceRemoval(first!.nonce);
    expect(useChatStore.getState().composerReferenceRemoval).toEqual(second);

    useChatStore.getState().consumeComposerReferenceRemoval(second!.nonce);
    expect(useChatStore.getState().composerReferenceRemoval).toBeNull();
  });
});
