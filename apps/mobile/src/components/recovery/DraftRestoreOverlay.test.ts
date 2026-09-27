// @ts-nocheck -- Vitest is supplied by the repository test runner.

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

import { executeDraftRestoreAction } from './DraftRestoreOverlay';

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
});
