// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({
  clearDraftRestore: vi.fn(),
  discard: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('../../runtimes/commandRuntime', () => ({
  discardReliabilityDrafts: recovery.discard,
  restoreReliabilityDrafts: recovery.restore,
}));
vi.mock('../../runtimes/recoveryProjection', () => ({
  getRecoveryProjection: () => ({
    clearDraftRestore: recovery.clearDraftRestore,
  }),
}));

import {
  DraftRestoreOverlay,
  executeDraftRestoreAction,
} from './DraftRestoreOverlay';

describe('DraftRestoreOverlay owner action', () => {
  beforeEach(() => {
    recovery.clearDraftRestore.mockReset();
    recovery.discard.mockReset();
    recovery.restore.mockReset();
  });

  it('clears recovery only after the owner delivered restored drafts', async () => {
    const drafts = [{ key: 'moment:compose' }];
    recovery.restore.mockResolvedValue([{ targetId: 'compose' }]);

    await expect(executeDraftRestoreAction('restore', drafts))
      .resolves.toBeUndefined();
    expect(recovery.restore).toHaveBeenCalledWith(drafts);
    expect(recovery.clearDraftRestore).toHaveBeenCalledOnce();
  });

  it('leaves recovery visible when owner-backed restoration fails', async () => {
    const drafts = [{ key: 'moment:compose' }];
    recovery.restore.mockRejectedValue(
      new Error('mobile.reliability.draftMissing'),
    );

    await expect(executeDraftRestoreAction('restore', drafts))
      .rejects.toThrow('mobile.reliability.draftMissing');
    expect(recovery.clearDraftRestore).not.toHaveBeenCalled();
  });

  it('summarizes draft kinds without exposing scope or target keys', () => {
    const markup = renderToStaticMarkup(createElement(DraftRestoreOverlay, {
      state: {
        kind: 'draft-restore-pending',
        discoveredAtMs: 1,
        drafts: [
          { key: 'station-a:ptid:alice:chat:conversation-secret', kind: 'chat' },
          { key: 'station-a:ptid:alice:moments:post-secret', kind: 'moments' },
        ],
      },
      t: (key: string, params?: Record<string, number>) =>
        `${key}:${params?.count ?? ''}`,
    }));

    expect(markup).toContain('mobile.recovery.draftRestore.chatCount:1');
    expect(markup).toContain('mobile.recovery.draftRestore.momentsCount:1');
    expect(markup).not.toContain('conversation-secret');
    expect(markup).not.toContain('post-secret');
    expect(markup).not.toContain('ptid:alice');
  });
});
