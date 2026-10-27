import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// AUD-15 mechanical pin: Cron, Bots and Lark binding selectors must consume
// the single Station roster (api.listAgents, directly or through the settings
// store) instead of maintaining surface-local agent lists. The prototype's
// local roster is a prototype-layer concept and must not be ported.
const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, relativePath), 'utf8');

describe('agent-roster single Station truth', () => {
  it('cron automation drawer loads the Station roster directly', () => {
    const source = read('../CronJobDrawer.tsx');
    expect(source).toContain('api.listAgents()');
  });

  it('bots settings binds agents from the Station roster', () => {
    const source = read('./BotsSettings.tsx');
    expect(source).toContain('api.listAgents()');
  });

  it('lark connection panels read agents from the settings store roster', () => {
    const source = read('./channels/LarkChannelsSettings.tsx');
    expect(source).toMatch(/state\)?\s*=>\s*state\.agents/);
  });

  it('the settings store roster is loaded from api.listAgents', () => {
    const source = read('../../store/settings.ts');
    expect(source).toContain('api.listAgents()');
  });

  it('the growth tab agent selector shares the same Station roster', () => {
    const source = read('./AgentGrowthTab.tsx');
    expect(source).toContain('api.listAgents()');
  });

  it('no binding surface keeps a hardcoded agent option list', () => {
    for (const relativePath of [
      './BotsSettings.tsx',
      './channels/LarkChannelsSettings.tsx',
      './channels/ChannelManagementPanels.tsx',
      './AgentGrowthTab.tsx',
    ]) {
      const source = read(relativePath);
      expect(source).not.toMatch(/value=["']agent-(?:1|2|default)["']/);
    }
  });
});
