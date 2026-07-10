import { describe, expect, it } from 'vitest';
import {
  buildPrototypeWorkspaceSnapshotRequestKey,
  shouldApplyPrototypeWorkspaceSnapshot,
} from './prototypeWorkspaceSnapshotOwnership';

describe('prototype workspace snapshot ownership', () => {
  it('keys workspace snapshots by source and monotonic sequence without execution payloads', () => {
    expect(buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'load',
      sequence: 1,
    })).toBe('source:load|seq:1');
    expect(buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'reload',
      sequence: 2.8,
    })).toBe('source:reload|seq:2');
    expect(buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'subscription',
    })).toBe('source:subscription|seq:0');
  });

  it('rejects stale workspace load snapshots after newer reload or subscription ownership changes', () => {
    const loadKey = buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'load',
      sequence: 1,
    });
    const reloadKey = buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'reload',
      sequence: 2,
    });
    const subscriptionKey = buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'subscription',
      sequence: 3,
    });

    expect(shouldApplyPrototypeWorkspaceSnapshot({
      currentRequestKey: loadKey,
      responseRequestKey: loadKey,
    })).toBe(true);
    expect(shouldApplyPrototypeWorkspaceSnapshot({
      currentRequestKey: reloadKey,
      responseRequestKey: loadKey,
    })).toBe(false);
    expect(shouldApplyPrototypeWorkspaceSnapshot({
      currentRequestKey: subscriptionKey,
      responseRequestKey: loadKey,
    })).toBe(false);
    expect(shouldApplyPrototypeWorkspaceSnapshot({
      currentRequestKey: subscriptionKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${loadKey} ${reloadKey} ${subscriptionKey}`).not.toMatch(
      /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute|file\.write/,
    );
  });

  it('rejects stale workspace load errors after newer reload or subscription ownership changes', () => {
    const loadErrorKey = buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'load',
      sequence: 4,
    });
    const reloadErrorKey = buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'reload',
      sequence: 5,
    });
    const subscriptionKey = buildPrototypeWorkspaceSnapshotRequestKey({
      source: 'subscription',
      sequence: 6,
    });

    expect(shouldApplyPrototypeWorkspaceSnapshot({
      currentRequestKey: loadErrorKey,
      responseRequestKey: loadErrorKey,
    })).toBe(true);
    expect(shouldApplyPrototypeWorkspaceSnapshot({
      currentRequestKey: reloadErrorKey,
      responseRequestKey: loadErrorKey,
    })).toBe(false);
    expect(shouldApplyPrototypeWorkspaceSnapshot({
      currentRequestKey: subscriptionKey,
      responseRequestKey: reloadErrorKey,
    })).toBe(false);
    expect(`${loadErrorKey} ${reloadErrorKey} ${subscriptionKey}`).not.toMatch(
      /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute|file\.write/,
    );
  });
});
