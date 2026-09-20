import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from './chat';

const RESOURCE_REF_HASH = 'a'.repeat(64);

describe('chat composer invalid resource-reference intent', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
    useChatStore.setState({ currentSessionKey: 'conversation-1' });
  });

  it('requests composer-owned resource selection without retrying or replacing the draft', () => {
    useChatStore.getState().fillComposer('preserved draft');
    const focusNonce = useChatStore.getState().composerFocusNonce;

    useChatStore.getState().requestComposerResourceSelection(
      'file',
      RESOURCE_REF_HASH,
    );

    expect(useChatStore.getState().composerResourceSelection).toEqual({
      sessionKey: 'conversation-1',
      resourceKind: 'file',
      resourceRefHash: RESOURCE_REF_HASH,
      nonce: expect.any(Number),
    });
    expect(useChatStore.getState().composerFill).toEqual({
      text: 'preserved draft',
      nonce: expect.any(Number),
    });
    expect(useChatStore.getState().composerFocusNonce).toBe(focusNonce);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('clears only the matching selection request generation', () => {
    useChatStore.getState().requestComposerResourceSelection(
      'file',
      RESOURCE_REF_HASH,
    );
    const first = useChatStore.getState().composerResourceSelection;

    useChatStore.getState().requestComposerResourceSelection(
      'image',
      'b'.repeat(64),
    );
    const second = useChatStore.getState().composerResourceSelection;

    expect(first).not.toBeNull();
    expect(second?.nonce).toBeGreaterThan(first?.nonce ?? 0);

    useChatStore.getState().consumeComposerResourceSelection(first!.nonce);
    expect(useChatStore.getState().composerResourceSelection).toEqual(second);

    useChatStore.getState().consumeComposerResourceSelection(second!.nonce);
    expect(useChatStore.getState().composerResourceSelection).toBeNull();
  });
});
