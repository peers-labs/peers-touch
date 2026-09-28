import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CORE_PAGE_LIST } from '../types/navigation';

const SETTINGS_ONLY_MODULES = ['channels', 'cron', 'oss', 'command-menu'] as const;

function moduleSource(moduleId: (typeof SETTINGS_ONLY_MODULES)[number]): string {
  return readFileSync(new URL(`./${moduleId}.ts`, import.meta.url), 'utf8');
}

function desktopSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('Desktop navigation ownership', () => {
  it.each(SETTINGS_ONLY_MODULES)('%s is owned only by Settings', (moduleId) => {
    const source = moduleSource(moduleId);

    expect(source).toContain(`id: '${moduleId}'`);
    expect(source).toMatch(/\bsettingsPanel:/);
    expect(source).toContain("sectionHostPolicy: { cache: 'selected-only' }");
    expect(source).not.toMatch(/\bpage:/);
    expect(source).not.toMatch(/\bsidebarEntry:/);
  });

  it('keeps all Settings utilities out of the primary module rail', () => {
    const combinedSource = SETTINGS_ONLY_MODULES.map(moduleSource).join('\n');

    expect(combinedSource).not.toMatch(/\bsidebarEntry:/);
    expect(combinedSource).not.toMatch(/\bpage:/);
  });

  it('does not expose standalone Notes as a core host page', () => {
    expect(CORE_PAGE_LIST).not.toContain('notes');
  });

  it('groups all migrated utilities under their Settings owners', () => {
    const source = desktopSource('pages/SettingsPage.tsx');

    expect(source).toContain("sectionKeys: ['cron', 'command-menu', 'tools']");
    expect(source).toContain("sectionKeys: ['channels', 'connections']");
    expect(source).toContain("sectionKeys: ['storage', 'oss', 'logs']");
  });

  it('routes utility deep links into Settings and rejects removed module routes', () => {
    const hashRouter = desktopSource('hooks/useHashRouter.ts');
    const navigation = desktopSource('hooks/useNavigation.ts');

    expect(hashRouter).toContain('getModule(segment)?.page');
    expect(hashRouter).not.toContain('parseDocIdFromHash');
    expect(navigation).toContain("setSettingsNav({ tab: 'cron' })");
    expect(navigation).toContain("setSettingsNav({ tab: 'channels' })");
    expect(navigation).toContain("router.setPage(DEFAULT_READY_PAGE)");
  });

  it('keeps Notes and the duplicate palette out of legacy shell ownership', () => {
    const pageRouter = desktopSource('components/PageRouter.tsx');
    const sideNav = desktopSource('components/AppSideNav.tsx');

    expect(pageRouter).not.toContain('NotesPage');
    expect(pageRouter).not.toContain("case 'notes'");
    expect(sideNav).not.toContain('commandPaletteOpen');
    expect(sideNav).not.toContain('layout.command.openPaletteWithShortcut');
  });
});
