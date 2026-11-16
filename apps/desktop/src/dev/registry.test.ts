import { beforeEach, describe, expect, it, vi } from 'vitest';

const Original = () => null;
const Updated = () => null;

beforeEach(() => vi.resetModules());

describe('dev overlay registration', () => {
  it('keeps one current definition after repeated hot registration', async () => {
    const { registerDevPlugin, getPluginsForSlot } = await import('./registry');
    registerDevPlugin({ id: 'worktree-badge', slot: 'bottomLeft', component: Original });
    registerDevPlugin({ id: 'worktree-badge', slot: 'bottomLeft', component: Original });
    registerDevPlugin({ id: 'worktree-badge', slot: 'bottomLeft', component: Updated });

    expect(getPluginsForSlot('bottomLeft')).toEqual([
      { id: 'worktree-badge', slot: 'bottomLeft', component: Updated },
    ]);
  });

  it('moves a replaced plugin between slots and preserves slot order', async () => {
    const { registerDevPlugin, getPluginsForSlot } = await import('./registry');
    registerDevPlugin({ id: 'late', slot: 'bottomLeft', order: 20, component: Original });
    registerDevPlugin({ id: 'early', slot: 'bottomLeft', order: 0, component: Original });
    registerDevPlugin({ id: 'moving', slot: 'bottomLeft', order: 10, component: Original });
    registerDevPlugin({ id: 'moving', slot: 'floating', order: 10, component: Updated });

    expect(getPluginsForSlot('bottomLeft').map(plugin => plugin.id)).toEqual(['early', 'late']);
    expect(getPluginsForSlot('floating')).toEqual([
      { id: 'moving', slot: 'floating', order: 10, component: Updated },
    ]);
  });
});
