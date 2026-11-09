// Source-contract: the Help/About surface follows the north-star prototype
// AboutSection — a real-host-facts meta grid (.sk-about-grid) rendered with
// SettingsRows. Version must come from the Tauri app API; no fabricated
// build numbers like the prototype's local demo fixture.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsPage = readFileSync(
  new URL('../../pages/SettingsPage.tsx', import.meta.url),
  'utf8',
);
const northstarCss = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');

const strippedCss = northstarCss.replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return strippedCss.match(
    new RegExp(`\\}\\s*${escaped}\\s*\\{([^}]*)\\}`),
  )?.[1] ?? '';
}

describe('about meta grid (north-star .sk-about-grid parity)', () => {
  it('reads the real app version from the Tauri app API', () => {
    expect(settingsPage).toContain("from '@tauri-apps/api/app'");
    expect(settingsPage).toContain('getVersion()');
    expect(settingsPage).toContain('data-about-meta');
  });

  it('renders four host-fact rows from locale keys, not hardcoded fixtures', () => {
    [
      'settings.help.aboutVersion',
      'settings.help.aboutPlatform',
      'settings.help.aboutEngine',
      'settings.help.aboutRuntime',
    ].forEach((key) => {
      expect(settingsPage).toContain(`t('${key}')`);
    });
    expect(settingsPage).not.toMatch(/v0\.\d|2026\d{4}\.\d{4}/);
  });

  it('derives platform and engine honestly from the user agent', () => {
    expect(settingsPage).toContain('detectHostPlatform');
    expect(settingsPage).toContain('detectRenderEngine');
    expect(settingsPage).toContain("return 'macOS'");
    expect(settingsPage).toContain("return 'WebKit'");
  });

  it('places the grid inside a plain About SettingsSection with the Info icon', () => {
    const aboutSlice = settingsPage.slice(
      settingsPage.indexOf('<SettingsSection', settingsPage.indexOf('function HelpTab')),
      settingsPage.indexOf('</SettingsSection>', settingsPage.indexOf('function HelpTab')),
    );
    expect(aboutSlice).toContain('icon={<Info size={18} />}');
    expect(aboutSlice).toContain('<AboutMetaSection />');
    expect(aboutSlice).not.toContain('linear-gradient');
  });

  it('uses the two-column prototype grid that collapses on narrow panes', () => {
    expect(rule('.sc-about-grid')).toContain(
      'grid-template-columns: 1fr 1fr',
    );
    expect(rule('.sc-about-grid__value')).toContain('ui-monospace, Menlo, monospace');
    expect(northstarCss).toMatch(
      /@media \(max-width: 760px\)\s*\{[^}]*\.sc-about-grid\s*\{\s*grid-template-columns: 1fr;\s*\}/,
    );
  });
});
