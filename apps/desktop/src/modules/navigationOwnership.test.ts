import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CORE_PAGE_LIST } from '../types/navigation';

const SELECTED_ONLY_MODULES = ['channels', 'cron', 'oss', 'command-menu'] as const;
const AI_SETTINGS_MODULES = ['discover', 'memory'] as const;
const SETTINGS_ONLY_MODULES = [...SELECTED_ONLY_MODULES, ...AI_SETTINGS_MODULES] as const;

function moduleSource(moduleId: string): string {
  return readFileSync(new URL(`./${moduleId}.ts`, import.meta.url), 'utf8');
}

function desktopSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('Desktop navigation ownership', () => {
  it.each(SELECTED_ONLY_MODULES)('%s is a selected-only Settings module', (moduleId) => {
    const source = moduleSource(moduleId);

    expect(source).toContain(`id: '${moduleId}'`);
    expect(source).toMatch(/\bsettingsPanel:/);
    expect(source).toContain("sectionHostPolicy: { cache: 'selected-only' }");
    expect(source).not.toMatch(/\bpage:/);
    expect(source).not.toMatch(/\bsidebarEntry:/);
  });

  it.each(AI_SETTINGS_MODULES)('%s is owned only by Settings > AI', (moduleId) => {
    const source = moduleSource(moduleId);

    expect(source).toContain(`id: '${moduleId}'`);
    expect(source).toMatch(/\bsettingsPanel:/);
    expect(source).toMatch(/\bsettingsEntry:/);
    expect(source).toContain("sectionHostPolicy: { cache: 'selected-only' }");
    expect(source).not.toMatch(/\bpage:/);
    expect(source).not.toMatch(/\bsidebarEntry:/);
  });

  it('keeps every Settings module out of page and primary-nav ownership', () => {
    const combinedSource = SETTINGS_ONLY_MODULES.map(moduleSource).join('\n');

    expect(combinedSource).not.toMatch(/\bsidebarEntry:/);
    expect(combinedSource).not.toMatch(/\bpage:/);
  });

  it('keeps the primary rail fixed and rejects dynamic injection', () => {
    const sideNav = desktopSource('components/AppSideNav.tsx');
    const registry = desktopSource('modules/registry.ts');
    const pageIds = [...sideNav.matchAll(/<PrimaryNavAnchor pageId="([^"]+)"/g)]
      .map((match) => match[1]);

    expect(pageIds).toEqual(['search', 'chat', 'agent', 'moments', 'settings']);
    expect(sideNav).not.toContain('pinnedAgents');
    expect(sideNav).not.toContain('pinnedApplets');
    expect(sideNav).not.toContain('getModulesWithSidebar');
    expect(registry).not.toContain('SidebarEntry');
    expect(registry).not.toContain('getModulesWithSidebar');
    expect(registry).not.toContain('getModulesWithPages');
  });

  it('owns Atelier as the only sibling work surface inside Agent', () => {
    const source = desktopSource('components/agent/AgentModuleNav.tsx');

    expect(source).toContain('data-pt-agent-module-item="chat"');
    expect(source).toContain('data-pt-agent-module-item="atelier"');
    expect(source).toContain("'applet:peers.atelier'");
    expect(source).not.toContain('evaluation');
    expect(source).not.toContain("label: t('agent.canvas");
  });

  it('keeps hidden capabilities routable without standalone Marketplace or Memory pages', () => {
    expect(CORE_PAGE_LIST).not.toContain('notes');
    expect(CORE_PAGE_LIST).not.toContain('marketplace');
    expect(CORE_PAGE_LIST).not.toContain('memory');
    expect(CORE_PAGE_LIST).toContain('moments');
    expect(CORE_PAGE_LIST).toContain('applets');
  });

  it('groups all migrated utilities under their Settings owners', () => {
    const source = desktopSource('pages/SettingsPage.tsx');

    expect(source).toContain("sectionKeys: ['cron', 'command-menu', 'tools']");
    expect(source).toContain("sectionKeys: ['channels', 'connections', 'bots']");
    expect(source).toContain("sectionKeys: ['storage', 'oss', 'logs']");
    expect(source).toContain("'providers', 'models', 'discover', 'memory'");
  });

  it('routes owned resources into Settings and rejects removed module routes', () => {
    const hashRouter = desktopSource('hooks/useHashRouter.ts');
    const navigation = desktopSource('hooks/useNavigation.ts');

    expect(hashRouter).not.toContain('getModule');
    expect(hashRouter).not.toContain('parseDocIdFromHash');
    expect(navigation).toContain("setSettingsNav({ tab: 'cron' })");
    expect(navigation).toContain("setSettingsNav({ tab: 'channels' })");
    expect(navigation).toContain("setSettingsNav({ tab: 'discover' })");
    expect(navigation).toContain("setPage(DEFAULT_READY_PAGE)");
  });

  it('keeps removed entries and the duplicate palette out of shell ownership', () => {
    const pageRouter = desktopSource('components/PageRouter.tsx');
    const sideNav = desktopSource('components/AppSideNav.tsx');
    const commandMenu = desktopSource('hooks/useCommandMenuItems.ts');

    expect(pageRouter).not.toContain('NotesPage');
    expect(pageRouter).not.toContain("case 'notes'");
    expect(pageRouter).not.toContain('getModule');
    expect(sideNav).not.toContain('commandPaletteOpen');
    expect(sideNav).not.toContain('layout.command.openPaletteWithShortcut');
    expect(sideNav).not.toContain('pageId="evaluation"');
    expect(sideNav).not.toContain('pageId="marketplace"');
    expect(sideNav).not.toContain('pageId="applets"');
    expect(commandMenu).not.toContain("page: 'evaluation'");
    expect(commandMenu).not.toContain("page: 'marketplace'");
  });
});
