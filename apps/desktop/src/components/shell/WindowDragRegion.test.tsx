import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Settings } from 'lucide-react';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { Button, MomentScopeBar, UIProvider } from '@peers-touch/ui';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../modules/registry', () => ({
  getModulesWithSettings: () => ['account', 'models', 'channels'].map(id => ({
    id, name: id, icon: Settings, settingsEntry: { label: id, order: 10 },
    settingsPanel: () => <span data-settings-fixture-panel={id}>{id}</span>,
  })),
}));
vi.mock('../../services/desktop_api', () => ({ api: {} }));
vi.mock('../../store/provider', () => ({ useProviderStore: {} }));
vi.mock('../../store/session', () => ({ useSessionStore: {} }));
vi.mock('../search/functions', () => ({ SEARCH_FUNCTIONS: [] }));
vi.mock('../../applets/registry', () => ({ hasSettingsPanel: () => false, getAppletFrontend: () => undefined }));
vi.mock('../common/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('../settings/ChatStorageSettings', () => ({ ChatStorageSettings: () => null }));
vi.mock('../settings/RecoverySettings', () => ({ RecoverySettings: () => null }));
vi.mock('../../kernel/usePrefetch', () => ({ usePrefetch: () => undefined }));
vi.mock('../../pages/useActiveSettingsStore', () => ({ useActiveSettingsSlice: () => ({}) }));
vi.mock('../agent/workbench/terminal/TerminalDock', () => ({ TerminalDock: () => null }));
vi.mock('../agent/workbench/browser/BrowserDock', () => ({ BrowserDock: () => null }));
vi.mock('../agent/workbench/file/FileDock', () => ({ FileDock: () => null }));
vi.mock('../agent/workbench/memory/MemoryReviewDock', () => ({ MemoryReviewDock: () => null }));
vi.mock('../agent/workbench/summary/TaskSummaryDock', () => ({ TaskSummaryDock: () => null }));
vi.mock('../agent/workbench/branches/BranchesDock', () => ({ BranchesDock: () => null }));
vi.mock('../../store/chat', () => ({
  useChatStore: (selector: (state: { currentSessionKey: string }) => unknown) => selector({ currentSessionKey: 'topic' }),
}));
vi.mock('../../store/agent', () => ({
  useAgentStore: (selector: (state: { selectedAgent: string }) => unknown) => selector({ selectedAgent: 'assistant' }),
}));
vi.mock('../../store/portal', () => ({
  usePortalStore: (selector: (state: { portalStack: unknown[] }) => unknown) => selector({ portalStack: [] }),
}));
vi.mock('../../store/workbenchTabs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/workbenchTabs')>();
  // SSR's default Zustand hook reads the initial snapshot. This fixture
  // explicitly selects the real store's prepared state for each header mode.
  return { ...actual, useWorkbenchTabsStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useWorkbenchTabsStore.getState>) => unknown) =>
      selector(actual.useWorkbenchTabsStore.getState()),
    actual.useWorkbenchTabsStore,
  ) };
});

import { GlobalLayout } from '../GlobalLayout';
import { PageHeader } from '../PageHeader';
import { SettingsPage } from '../../pages/SettingsPage';
import { PortalHeader } from '../portal/PortalHeader';
import { WorkbenchPanel } from '../agent/workbench/WorkbenchPanel';
import { useWorkbenchTabsStore } from '../../store/workbenchTabs';
import { WindowDragRegion } from './WindowDragRegion';

interface HeaderFixture {
  name: string;
  html: string;
  drag: string[];
  controls: string[];
}

const fixtures: HeaderFixture[] = [];
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
const sources: Record<string, string> = {};

function fixture(name: string, content: ReactNode, drag: string[], controls: string[]) {
  const rendered = { name, html: renderToStaticMarkup(content), drag, controls };
  fixtures.push(rendered);
  return rendered.html;
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe('Desktop window chrome composition', () => {
  it('keeps the frame DOM and makes only the frame itself draggable', () => {
    const html = fixture('frame', (
      <GlobalLayout sideNav={<nav>rail</nav>}>
        <section><p>selectable content</p><input defaultValue="keep draft" /></section>
      </GlobalLayout>
    ), ['.ds-shell'], ['nav', '.ds-stage', 'p', 'input']);
    expect(html).toMatch(/^<div class="ds-shell" data-tauri-drag-region="true"><nav>/);
    expect(html).toContain('<div class="ds-stage"><section>');
    expect(html.match(/data-tauri-drag-region/g)).toHaveLength(1);
  });

  it('renders the real Settings group bar without enrolling its controls or content', () => {
    const html = fixture('settings', <SettingsPage />,
      ['.sc-settings__subbar'],
      ['[data-settings-group="general"]', '[data-settings-group="ai"] svg',
        '[data-settings-section="account"]', '[data-settings-fixture-panel="account"]']);
    expect(html).toContain('class="sc-settings__subbar" data-tauri-drag-region="deep"');
    expect(html.match(/data-tauri-drag-region/g)).toHaveLength(1);
    expect(html).toContain('class="sc-settings__scroll"');
  });

  it('keeps common header actions, Moments search chrome and Portal custom tabs interactive', () => {
    const html = fixture('common-header', (
      <PageHeader title="Files" subtitle="Host header" actions={<Button actionId="header-back">Back</Button>} />
    ), ['h4', '[data-tauri-drag-region="deep"]'], ['button', '[data-tauri-drag-region="false"]']);
    expect(html).toContain('data-tauri-drag-region="false"');
    fixture('moments', <WindowDragRegion><MomentScopeBar
      value="feed" options={[{ value: 'feed', label: 'Feed' }, { value: 'circles', label: 'Circles' }]}
      onChange={() => undefined} query="" onQueryChange={() => undefined}
      copy={{ scope: 'Scope', search: 'Search', action: 'Compose' }}
      actionId="compose" onAction={() => undefined}
    /></WindowDragRegion>, ['.sk-moments-subbar'], ['button', 'input', '.sk-scope-wrap', '.sk-scope-wrap svg']);
    const portal = fixture('portal', <PortalHeader activeView={{ type: 'workingFiles', sessionKey: 'topic' }} />,
      ['[data-tauri-drag-region="deep"]'], ['[data-pt-agent-portal-tab="files"]', '[data-pt-agent-portal-tab="files"] svg', '[data-pt-agent-portal-close]']);
    expect(portal).toContain('data-tauri-drag-region="false"');
  });

  it('covers both workbench header states and never enrolls tabs, resizer or launcher', () => {
    useWorkbenchTabsStore.setState({ panelOpen: true, tabs: [], active: null });
    fixture('workbench-launcher', <UIProvider><WorkbenchPanel /></UIProvider>, ['.wb-shell-header', '.wb-shell-header > span'],
      ['[data-pt-workbench-fold]', '[data-pt-workbench-resize]', '.wb-shell-launcher']);
    useWorkbenchTabsStore.setState({ panelOpen: true, tabs: ['file', 'terminal'], active: 'file' });
    const html = fixture('workbench-tabs', <UIProvider><WorkbenchPanel /></UIProvider>, ['.wb-shell-header'],
      ['[data-pt-workbench-tab="file"]', '[data-pt-workbench-tab="file"] svg',
        '[data-pt-workbench-close="terminal"]', '[data-pt-workbench-fold]', '[data-pt-workbench-resize]']);
    expect(html).toContain('class="wb-shell-tabs" data-tauri-drag-region="false"');
    expect(html).toContain('data-pt-workbench-resize="true"');
    useWorkbenchTabsStore.getState().closeAll();
  });

  it('centralizes native attributes and rejects unclassified window header declarations', () => {
    // These are headers inside content/cards, not the native window/pane chrome.
    const contentHeaders = new Set([
      'components/profile/PublicProfileCard.tsx:pp-author-head',
      'components/chat/message/ServiceMessageCard.tsx:sc-activity__head',
      'components/settings/channels/ChannelManagementPanels.tsx:pt-channel-panel-header',
      'components/settings/channels/LarkChannelsSettings.tsx:pt-channel-collection-title',
      'components/settings/channels/LarkChannelsSettings.tsx:pt-channel-workspace__header',
      'components/settings/channels/LarkChannelsSettings.tsx:pt-channel-page-header',
      'components/settings/MemorySettingsSection.tsx:sc-memory__header',
      'pages/SettingsPage.tsx:sc-danger__head',
    ]);
    let checkedHeaders = 0;
    for (const path of files(sourceRoot)) {
      if (/\.(test|fixture)\./.test(path)) continue;
      const relative = path.slice(sourceRoot.length).replace(/^\//, '');
      const text = readFileSync(path, 'utf8');
      sources[`apps/desktop/src/${relative}`] = createHash('sha256').update(text).digest('hex');
      const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'data-tauri-drag-region') {
          expect(relative, 'Native markers belong only to WindowDragRegion').toBe('components/shell/WindowDragRegion.tsx');
        }
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'header') {
          const className = node.openingElement.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'className');
          const value = className && ts.isJsxAttribute(className) && className.initializer && ts.isStringLiteral(className.initializer)
            ? className.initializer.text : '';
          if (!contentHeaders.has(`${relative}:${value}`)) {
            expect(ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(ast),
              `${relative}: native header must consume WindowDragRegion, or be classified as content`).toBe('WindowDragRegion');
            checkedHeaders++;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(checkedHeaders).toBeGreaterThanOrEqual(6);
    const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
    for (const path of ['packages/ui/web/src/moment-scope-bar.tsx', 'apps/desktop/src-tauri/Cargo.lock']) {
      sources[path] = createHash('sha256').update(readFileSync(`${repoRoot}/${path}`)).digest('hex');
    }
    // Opt-in export for the real-browser/native-script contract check.
    // Ordinary unit runs need neither browsers nor a Cargo source download.
    const output = process.env.PT_WINDOW_CHROME_FIXTURES;
    if (output) {
      expect(fixtures).toHaveLength(7);
      writeFileSync(output, JSON.stringify({ sources, fixtures }, null, 2));
    }
  });
});
