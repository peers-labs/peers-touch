import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  readSkillResource: vi.fn(),
  readManagedSkillResource: vi.fn(),
}));

vi.mock('./desktop_api', () => ({
  api: apiMock,
}));

import { isTextResourceReadable, skillService } from './skill-service';

describe('Skill versioned resource dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads Station-owned text through the Station blob API', async () => {
    apiMock.readSkillResource.mockResolvedValue({
      content: new TextEncoder().encode('# Reference'),
    });

    const content = await skillService.readVersionedResource({
      agentId: 'agent-1',
      skillId: 'skill-1',
      version: 3,
      path: 'references/api.md',
      owner: 'station',
    });

    expect(content).toBe('# Reference');
    expect(apiMock.readSkillResource).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        skillId: 'skill-1',
        version: 3,
        path: 'references/api.md',
      }),
    );
    expect(apiMock.readManagedSkillResource).not.toHaveBeenCalled();
  });

  it('reads client-owned text from the local managed package with hash pin', async () => {
    apiMock.readManagedSkillResource.mockResolvedValue({
      path: 'scripts/run.sh',
      version: 2,
      content: '#!/bin/sh\n',
    });

    const content = await skillService.readVersionedResource({
      agentId: 'agent-1',
      skillId: 'skill-1',
      version: 2,
      path: 'scripts/run.sh',
      owner: 'client_capability',
      contentHash: 'abc123',
    });

    expect(content).toBe('#!/bin/sh\n');
    expect(apiMock.readManagedSkillResource).toHaveBeenCalledWith({
      skillId: 'skill-1',
      version: 2,
      path: 'scripts/run.sh',
      contentHash: 'abc123',
    });
    expect(apiMock.readSkillResource).not.toHaveBeenCalled();
  });

  it('fails closed for an undeclared execution owner', async () => {
    await expect(
      skillService.readVersionedResource({
        agentId: 'agent-1',
        skillId: 'skill-1',
        version: 1,
        path: 'references/api.md',
        owner: 'unspecified',
      }),
    ).rejects.toThrow('agent.skill.resourceOwnerUnsupported');
    expect(apiMock.readSkillResource).not.toHaveBeenCalled();
    expect(apiMock.readManagedSkillResource).not.toHaveBeenCalled();
  });
});

describe('isTextResourceReadable', () => {
  it('exposes Station references and client scripts but not the entrypoint or assets', () => {
    expect(isTextResourceReadable({
      path: 'SKILL.md',
      role: 'entrypoint',
      executionOwner: undefined,
    })).toBe(false);
    expect(isTextResourceReadable({
      path: 'assets/logo.png',
      role: 'asset',
      executionOwner: 'client_capability',
    })).toBe(false);
    expect(isTextResourceReadable({
      path: 'references/api.md',
      role: 'reference',
      executionOwner: 'station',
    })).toBe(true);
    expect(isTextResourceReadable({
      path: 'scripts/run.sh',
      role: 'script',
      executionOwner: 'client_capability',
    })).toBe(true);
    expect(isTextResourceReadable({
      path: 'notes.md',
      role: 'reference',
      executionOwner: 'unspecified',
    })).toBe(false);
  });
});
