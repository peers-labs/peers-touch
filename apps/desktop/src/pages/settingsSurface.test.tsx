import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from 'lucide-react';

const registry = vi.hoisted(() => ({ ids: ['account', 'models', 'channels'] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../modules/registry', () => ({
  getModulesWithSettings: () => registry.ids.map((id) => ({
    id,
    name: id,
    icon: Settings,
    settingsEntry: { label: id, order: 10 },
    settingsPanel: () => <span data-rendered-settings-panel={id}>{id}</span>,
  })),
}));
vi.mock('../services/desktop_api', () => ({ api: {} }));
vi.mock('../store/provider', () => ({ useProviderStore: {} }));
vi.mock('../store/session', () => ({ useSessionStore: {} }));
vi.mock('../components/search/functions', () => ({ SEARCH_FUNCTIONS: [] }));
vi.mock('../applets/registry', () => ({ hasSettingsPanel: () => false, getAppletFrontend: () => undefined }));
vi.mock('../components/common/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('../components/settings/ChatStorageSettings', () => ({ ChatStorageSettings: () => null }));
vi.mock('../components/settings/RecoverySettings', () => ({ RecoverySettings: () => null }));
vi.mock('../kernel/usePrefetch', () => ({ usePrefetch: () => undefined }));
vi.mock('./useActiveSettingsStore', () => ({ useActiveSettingsSlice: () => ({}) }));

import { SettingsPage } from './SettingsPage';

describe('Settings surface composition', () => {
  beforeEach(() => {
    registry.ids = ['account', 'models', 'channels'];
  });

  it('renders the active section inside the token root and the sole scroll owner', () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    // CSS can pass its own contract while the actual page loses the class
    // that defines its aliases and gutter. Exercise the real page + SectionHost.
    expect(html).toMatch(/^<div class="sc-settings">/);
    expect(html).toMatch(
      /<div class="sc-settings__scroll" data-settings-content="true"><div data-pt-section-host="account"/,
    );
    expect(html).toContain('data-rendered-settings-panel="account"');
    expect(html).not.toContain('data-rendered-settings-panel="models"');
    expect(html).not.toContain('data-rendered-settings-panel="channels"');
    expect(html.match(/class="sc-settings__scroll"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<h1|<h2/);
  });

  it('uses the compact group island and stable section rail', () => {
    const html = renderToStaticMarkup(<SettingsPage />);
    expect(html.match(/data-settings-group="([^"]+)"/g)).toEqual([
      'data-settings-group="general"',
      'data-settings-group="ai"',
      'data-settings-group="channels"',
      'data-settings-group="advanced"',
    ]);
    expect(html).toContain('class="pt-segmented sc-settings__groups" role="group"');
    expect(html).toContain('class="sc-settings__sidebar"');
    expect(html).toContain('data-settings-section="account"');
    expect(html).toContain('data-settings-section="security"');
    expect(html).toContain('data-settings-section="general"');
  });

  it('omits empty groups and never revives management sections from registry drift', () => {
    registry.ids = ['account', 'providers', 'federation'];
    const html = renderToStaticMarkup(<SettingsPage />);
    expect(html.match(/data-settings-group="([^"]+)"/g)).toEqual([
      'data-settings-group="general"',
      'data-settings-group="advanced"',
    ]);
    expect(html).not.toContain('data-settings-section="providers"');
    expect(html).not.toContain('data-settings-section="federation"');
    expect(html).not.toContain('data-rendered-settings-panel="providers"');
    expect(html).not.toContain('data-rendered-settings-panel="federation"');
  });
});
