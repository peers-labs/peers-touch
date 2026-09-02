import { describe, expect, it } from 'vitest';

import {
  assertFoundationCapabilityFixtureCleanupState,
  assertFoundationCapabilityIsolationPrerequisites,
  assertFoundationCapabilityIsolationAgentVersion,
  isFoundationCapabilityIsolationRestored,
  parseFoundationCapabilityFixtureJournal,
  parseFoundationCapabilityIsolationJournal,
  planFoundationCapabilityBindingRestoration,
  restoreFoundationCapabilityBindings,
} from './capabilityIsolation';
import { CapabilityApprovalPolicy } from '../../gen/proto/domain/agent/capability_pb';

describe('planFoundationCapabilityBindingRestoration', () => {
  const original = {
    bindingId: 'binding-non-ready',
    capabilityId: 'skill:original',
    capabilityVersion: '1',
    approvalPolicy: CapabilityApprovalPolicy.MANUAL,
    originalRevision: '2',
    isolatedRevision: '3',
    restoredRevision: '4',
  };
  const current = {
    ...original,
    $typeName: 'peers_touch.model.agent.v1.AgentCapabilityBinding' as const,
    ptid: 'ptid:v1:actor:peers:p:test:1220abc',
    agentId: 'agent-1',
    enabled: true,
    expectedAgentVersion: 1n,
    revision: 2n,
    tombstonedByPtid: '',
    tombstoneReason: '',
  };

  it('accepts the journaled capability identity', () => {
    expect(
      planFoundationCapabilityBindingRestoration([original], [current]),
    ).toEqual([{ original, current, requiresRestore: false }]);
  });

  it.each([
    {
      capabilityId: 'skill:retargeted',
      capabilityVersion: original.capabilityVersion,
    },
    {
      capabilityId: original.capabilityId,
      capabilityVersion: '2',
    },
  ])(
    'rejects a retargeted non-ready binding before readiness verification',
    ({ capabilityId, capabilityVersion }) => {
      const restorationWrites: string[] = [];
      const first = {
        ...current,
        bindingId: 'binding-ready',
        capabilityId: 'skill:ready',
      };

      expect(() => {
        const plan = planFoundationCapabilityBindingRestoration(
          [
            {
              bindingId: first.bindingId,
              capabilityId: first.capabilityId,
              capabilityVersion: first.capabilityVersion,
              approvalPolicy: first.approvalPolicy,
              originalRevision: '2',
              isolatedRevision: '3',
              restoredRevision: '4',
            },
            original,
          ],
          [
            first,
            {
              ...current,
              capabilityId,
              capabilityVersion,
            },
          ],
        );
        plan.forEach(({ current: binding }) => {
          restorationWrites.push(binding.bindingId);
        });
      }).toThrow(
        'agent.acceptance.foundationCapabilityBindingIdentityChanged',
      );
      expect(restorationWrites).toEqual([]);
    },
  );

  it('rejects identity drift found by per-binding revalidation', () => {
    expect(
      planFoundationCapabilityBindingRestoration([original], [current]),
    ).toHaveLength(1);

    expect(() => {
      planFoundationCapabilityBindingRestoration([original], [{
        ...current,
        capabilityId: 'skill:retargeted-after-preflight',
      }]);
    }).toThrow(
      'agent.acceptance.foundationCapabilityBindingIdentityChanged',
    );
  });

  it('restores only the exact revision created by isolation', () => {
    expect(
      planFoundationCapabilityBindingRestoration([original], [{
        ...current,
        enabled: false,
        revision: 3n,
      }]),
    ).toEqual([{
      original,
      current: {
        ...current,
        enabled: false,
        revision: 3n,
      },
      requiresRestore: true,
    }]);

    expect(() => {
      planFoundationCapabilityBindingRestoration([original], [{
        ...current,
        revision: 5n,
      }]);
    }).toThrow(
      'agent.acceptance.foundationCapabilityBindingStateChanged',
    );
  });

  it('performs no writes when later-binding drift appears after preflight', async () => {
    const first = {
      ...current,
      bindingId: 'binding-ready',
      capabilityId: 'skill:ready',
    };
    let listCall = 0;
    const writes: string[] = [];

    await expect(restoreFoundationCapabilityBindings(
      [
        {
          bindingId: first.bindingId,
          capabilityId: first.capabilityId,
          capabilityVersion: first.capabilityVersion,
          approvalPolicy: first.approvalPolicy,
          originalRevision: '2',
          isolatedRevision: '3',
          restoredRevision: '4',
        },
        original,
      ],
      async () => {
        listCall += 1;
        return listCall === 1
          ? [first, current]
          : [
              first,
              {
                ...current,
                capabilityId: 'skill:retargeted-after-preflight',
              },
            ];
      },
      async (_original, binding) => {
        writes.push(binding.bindingId);
      },
    )).rejects.toThrow(
      'agent.acceptance.foundationCapabilityBindingIdentityChanged',
    );
    expect(writes).toEqual([]);
  });

  it('stops writes when identity drifts between restoration writes', async () => {
    const first = {
      ...current,
      bindingId: 'binding-first',
      capabilityId: 'skill:first',
      enabled: false,
      revision: 3n,
    };
    const second = {
      ...current,
      bindingId: 'binding-second',
      capabilityId: 'skill:second',
      enabled: false,
      revision: 3n,
    };
    const originals = [first, second].map((binding) => ({
      bindingId: binding.bindingId,
      capabilityId: binding.capabilityId,
      capabilityVersion: binding.capabilityVersion,
      approvalPolicy: binding.approvalPolicy,
      originalRevision: '2',
      isolatedRevision: '3',
      restoredRevision: '4',
    }));
    let listCall = 0;
    const writes: string[] = [];

    await expect(restoreFoundationCapabilityBindings(
      originals,
      async () => {
        listCall += 1;
        if (listCall < 3) return [first, second];
        return [{
          ...first,
          capabilityVersion: 'retargeted-after-first-write',
        }, second];
      },
      async (_original, binding) => {
        writes.push(binding.bindingId);
      },
    )).rejects.toThrow(
      'agent.acceptance.foundationCapabilityBindingIdentityChanged',
    );
    expect(writes).toEqual(['binding-second']);
  });
});

describe('parseFoundationCapabilityIsolationJournal', () => {
  const journal = {
    agentId: 'agent-1',
    agentVersion: 7,
    originalReadyCapabilityCount: 1,
    originalReadyCapabilityHash: 'a'.repeat(64),
    bindings: [{
      bindingId: 'binding-1',
      capabilityId: 'skill:one',
      capabilityVersion: '1',
      approvalPolicy: CapabilityApprovalPolicy.MANUAL,
      originalRevision: '2',
      isolatedRevision: '3',
      restoredRevision: '4',
    }],
  };

  it('distinguishes an absent journal from malformed stored content', () => {
    expect(parseFoundationCapabilityIsolationJournal(null)).toBeNull();
    expect(() => {
      parseFoundationCapabilityIsolationJournal('');
    }).toThrow(
      'agent.acceptance.foundationCapabilityIsolationJournalInvalid',
    );
  });

  it.each([
    { agentId: 123 },
    { agentVersion: '7' },
    { agentVersion: 0 },
    { originalReadyCapabilityCount: -1 },
    { originalReadyCapabilityHash: 'z'.repeat(64) },
    { bindings: [] },
    {
      bindings: [{
        ...journal.bindings[0],
        approvalPolicy: 999,
      }],
    },
    {
      bindings: [{
        ...journal.bindings[0],
        isolatedRevision: '4',
      }],
    },
    {
      bindings: [
        journal.bindings[0],
        journal.bindings[0],
      ],
    },
  ])('rejects malformed durable journal fields', (override) => {
    expect(() => {
      parseFoundationCapabilityIsolationJournal(JSON.stringify({
        ...journal,
        ...override,
      }));
    }).toThrow(
      'agent.acceptance.foundationCapabilityIsolationJournalInvalid',
    );
  });

  it('accepts zero original readiness for non-revision scenarios', () => {
    expect(parseFoundationCapabilityIsolationJournal(JSON.stringify({
      ...journal,
      originalReadyCapabilityCount: 0,
    }))).toMatchObject({
      originalReadyCapabilityCount: 0,
    });
  });
});

describe('isFoundationCapabilityIsolationRestored', () => {
  const restored = {
    disabledBindingCount: 1,
    readyCapabilityCount: 0,
    originalReadyCapabilityCount: 1,
    originalReadyCapabilityHash: 'a'.repeat(64),
    restoredBindingCount: 1,
    restoredReadyCapabilityCount: 1,
    restoredReadyCapabilityHash: 'a'.repeat(64),
    restorationVerified: true,
  };

  it('accepts exact integer restoration evidence', () => {
    expect(isFoundationCapabilityIsolationRestored(restored)).toBe(true);
  });

  it.each([
    { disabledBindingCount: '1' },
    { restoredBindingCount: 1.5 },
    { originalReadyCapabilityCount: '1' },
    { restoredReadyCapabilityCount: 1.5 },
    {
      originalReadyCapabilityHash: 'z'.repeat(64),
      restoredReadyCapabilityHash: 'z'.repeat(64),
    },
  ])('rejects malformed restoration evidence', (override) => {
    expect(isFoundationCapabilityIsolationRestored({
      ...restored,
      ...override,
    })).toBe(false);
  });
});

describe('parseFoundationCapabilityFixtureJournal', () => {
  const journal = {
    agentId: 'agent-1',
    agentVersion: 7,
    capabilityId: 'skill:fixture',
    capabilityVersion: '1',
    setupIdempotencyKey: 'fixture-setup-key',
    originalBinding: {
      bindingId: 'binding-1',
      enabled: false,
      approvalPolicy: CapabilityApprovalPolicy.DENY,
      revision: '4',
    },
  };

  it('parses an exact original binding snapshot', () => {
    expect(parseFoundationCapabilityFixtureJournal(
      JSON.stringify(journal),
    )).toEqual(journal);
  });

  it('parses a durable cleanup replay boundary', () => {
    expect(parseFoundationCapabilityFixtureJournal(JSON.stringify({
      ...journal,
      cleanupExpectedRevision: '7',
      cleanupIdempotencyKey: 'fixture-cleanup-key',
    }))).toMatchObject({
      cleanupExpectedRevision: '7',
      cleanupIdempotencyKey: 'fixture-cleanup-key',
    });
  });

  it.each([
    { agentVersion: 0 },
    { capabilityId: 1 },
    { setupIdempotencyKey: '' },
    {
      originalBinding: {
        ...journal.originalBinding,
        revision: '0',
      },
    },
    {
      originalBinding: {
        ...journal.originalBinding,
        approvalPolicy: 999,
      },
    },
    { cleanupExpectedRevision: '7' },
    { cleanupIdempotencyKey: 'fixture-cleanup-key' },
    {
      cleanupExpectedRevision: '0',
      cleanupIdempotencyKey: 'fixture-cleanup-key',
    },
  ])('rejects malformed fixture journals', (override) => {
    expect(() => {
      parseFoundationCapabilityFixtureJournal(JSON.stringify({
        ...journal,
        ...override,
      }));
    }).toThrow(
      'agent.acceptance.foundationCapabilityIsolationJournalInvalid',
    );
  });
});

describe('assertFoundationCapabilityIsolationAgentVersion', () => {
  it('accepts the authoritative journaled version', () => {
    expect(() => {
      assertFoundationCapabilityIsolationAgentVersion(7, 7);
    }).not.toThrow();
  });

  it.each([8, 7.5, Number.NaN])(
    'rejects authoritative version drift or malformed value %s',
    (currentVersion) => {
      expect(() => {
        assertFoundationCapabilityIsolationAgentVersion(7, currentVersion);
      }).toThrow(
        'agent.acceptance.foundationCapabilityIsolationAgentChanged',
      );
    },
  );
});

describe('assertFoundationCapabilityFixtureCleanupState', () => {
  const prepared = {
    $typeName: 'peers_touch.model.agent.v1.AgentCapabilityBinding' as const,
    bindingId: 'binding-fixture',
    ptid: 'ptid:v1:actor:peers:p:test:1220abc',
    agentId: 'agent-1',
    capabilityId: 'skill:fixture',
    capabilityVersion: '1',
    enabled: true,
    approvalPolicy: CapabilityApprovalPolicy.MANUAL,
    expectedAgentVersion: 1n,
    revision: 5n,
    tombstonedByPtid: '',
    tombstoneReason: '',
  };

  it.each([5n, 7n])(
    'accepts the prepared or isolation-restored revision %s',
    (revision) => {
      expect(() => {
        assertFoundationCapabilityFixtureCleanupState(prepared, {
          ...prepared,
          revision,
        });
      }).not.toThrow();
    },
  );

  it.each([
    { revision: 6n },
    { revision: 8n },
    { enabled: false },
    { approvalPolicy: CapabilityApprovalPolicy.DENY },
    { capabilityVersion: 'retargeted' },
  ])('rejects concurrent fixture state drift', (override) => {
    expect(() => {
      assertFoundationCapabilityFixtureCleanupState(prepared, {
        ...prepared,
        ...override,
      });
    }).toThrow();
  });
});

describe('assertFoundationCapabilityIsolationPrerequisites', () => {
  const binding = {
    bindingId: 'binding-1',
    capabilityId: 'skill:one',
    capabilityVersion: '1',
    approvalPolicy: CapabilityApprovalPolicy.MANUAL,
    originalRevision: '2',
    isolatedRevision: '3',
    restoredRevision: '4',
  };

  it('accepts a positive isolation boundary', () => {
    expect(() => {
      assertFoundationCapabilityIsolationPrerequisites([binding], 1, true);
    }).not.toThrow();
  });

  it.each([
    { bindings: [], readyCapabilityCount: 1, required: false },
    { bindings: [], readyCapabilityCount: 0, required: true },
    { bindings: [binding], readyCapabilityCount: 0, required: true },
    { bindings: [binding], readyCapabilityCount: 1.5, required: false },
  ])('rejects a journal that cleanup cannot restore', ({
    bindings,
    readyCapabilityCount,
    required,
  }) => {
    expect(() => {
      assertFoundationCapabilityIsolationPrerequisites(
        bindings,
        readyCapabilityCount,
        required,
      );
    }).toThrow(
      'agent.acceptance.foundationCapabilityIsolationUnavailable',
    );
  });

  it('allows an already isolated zero-capability scenario without a journal', () => {
    expect(() => {
      assertFoundationCapabilityIsolationPrerequisites([], 0, false);
    }).not.toThrow();
  });
});
