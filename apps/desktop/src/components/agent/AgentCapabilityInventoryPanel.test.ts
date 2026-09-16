import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/ui', () => ({
  Button: () => null,
  Tag: () => null,
}));

import {
  AgentCapabilityBindingSchema,
  CapabilityAvailability,
  CapabilityManifestSchema,
  CapabilityReadinessSchema,
  CapabilityReadinessState,
  CapabilitySourceKind,
} from '../../gen/proto/domain/agent/capability_pb';
import {
  isCapabilityBindingToggleDisabled,
  projectCapabilityInventory,
} from './AgentCapabilityInventoryPanel';

function manifest(
  capabilityId: string,
  sourceKind: CapabilitySourceKind,
  name: string,
  availability = CapabilityAvailability.AVAILABLE,
) {
  return create(CapabilityManifestSchema, {
    capabilityId,
    version: '1',
    sourceKind,
    sourceInstanceId: `${capabilityId}-source`,
    displayMetadata: { name },
    availability,
  });
}

describe('AgentCapabilityInventoryPanel projection', () => {
  it('joins the complete non-knowledge catalog and sorts it deterministically', () => {
    const skill = manifest('skill.research', CapabilitySourceKind.SKILL, 'Research');
    const tool = manifest('tool.search', CapabilitySourceKind.BUILTIN_TOOL, 'Search');
    const connector = manifest(
      'connector.calendar',
      CapabilitySourceKind.CONNECTOR,
      'Calendar',
    );
    const knowledge = manifest(
      'knowledge.document',
      CapabilitySourceKind.KNOWLEDGE,
      'Document',
    );
    const oldBinding = create(AgentCapabilityBindingSchema, {
      bindingId: 'binding-old',
      capabilityId: tool.capabilityId,
      capabilityVersion: tool.version,
      enabled: true,
      revision: 1n,
    });
    const currentBinding = create(AgentCapabilityBindingSchema, {
      bindingId: 'binding-current',
      capabilityId: tool.capabilityId,
      capabilityVersion: tool.version,
      enabled: true,
      revision: 2n,
    });
    const toolReadiness = create(CapabilityReadinessSchema, {
      capabilityId: tool.capabilityId,
      capabilityVersion: tool.version,
      bindingId: currentBinding.bindingId,
      bindingRevision: currentBinding.revision,
      state: CapabilityReadinessState.READY,
      authority: 'station-capability-authority',
      reasonCode: 'capability_ready',
    });

    const projection = projectCapabilityInventory(
      [skill, knowledge, connector, tool],
      [oldBinding, currentBinding],
      [toolReadiness],
    );

    expect(projection.map((item) => item.manifest.capabilityId)).toEqual([
      'tool.search',
      'connector.calendar',
      'skill.research',
    ]);
    expect(projection[0].binding?.bindingId).toBe('binding-current');
    expect(projection[0].readiness).toBe(toolReadiness);
    expect(projection[1].binding).toBeUndefined();
  });

  it('keeps unavailable bound capabilities operable for unbinding', () => {
    const unavailable = manifest(
      'connector.calendar',
      CapabilitySourceKind.CONNECTOR,
      'Calendar',
      CapabilityAvailability.UNAVAILABLE,
    );
    const binding = create(AgentCapabilityBindingSchema, {
      bindingId: 'binding-calendar',
      capabilityId: unavailable.capabilityId,
      capabilityVersion: unavailable.version,
      enabled: true,
      revision: 3n,
    });
    const [boundItem] = projectCapabilityInventory(
      [unavailable],
      [binding],
      [],
    );
    const [unboundItem] = projectCapabilityInventory(
      [unavailable],
      [],
      [],
    );

    expect(isCapabilityBindingToggleDisabled(boundItem, false)).toBe(false);
    expect(isCapabilityBindingToggleDisabled(unboundItem, false)).toBe(true);
    expect(isCapabilityBindingToggleDisabled(boundItem, true)).toBe(true);
  });
});
