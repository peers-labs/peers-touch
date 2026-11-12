// Source-contract: FederationTab follows the north-star NetworkSections
// grammar — identity values are settings rows (.sk-handle / .sk-mono),
// joined federations are flat .sk-settings-item blocks with the 7px state
// dot and a muted endpoint line, and empty states use .sk-field-hint.
// Desktop's real federation data (id/name/status) and acceptance hooks stay.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./FederationTab.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');
const prototypeCss = readFileSync(
  new URL(
    '../../../../../packages/prototypes/shared/ui-system/settings/settings.css',
    import.meta.url,
  ),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('federation identity rows (north-star .sk-handle parity)', () => {
  it('renders handle and station inside settings rows, not a bespoke 2-col grid', () => {
    expect(source).not.toContain('sc-fed-identity-grid');
    expect(source).toContain('<span className="sk-handle">');
    expect(source).toContain('<code className="sk-mono">');
    expect(source).toMatch(/<SettingsRow label=\{t\('settings\.federation\.identity\.handle'\)\}>/);
    expect(source).toMatch(/<SettingsRow label=\{t\('settings\.federation\.identity\.homeStation'\)\}>/);
  });

  it('uses the prototype 13px / 550 handle weight', () => {
    const handle = rule('.sk-handle');
    expect(handle).toContain('font-size: 13px');
    expect(handle).toContain('font-weight: 550');
    expect(handle).toContain('gap: 4px');
    expect(prototypeCss).toMatch(/\.sk-handle\s*\{[^}]*font-size: 13px[^}]*font-weight: 550/);
  });
});

describe('joined federation list (north-star .sk-federation-* parity)', () => {
  it('renders flat item blocks with name, state dot, status tag and muted endpoint', () => {
    expect(source).toContain('className="sk-federation-list"');
    expect(source).toContain('className="sk-settings-item"');
    expect(source).toContain('className="sk-federation-row"');
    expect(source).toContain('className="sk-federation-id"');
    expect(source).toMatch(/<i data-active=\{federation\.status === 'active' \? '1' : '0'\}\s*\/>/);
    expect(source).toContain('className="sk-federation-desc"');
    // The native acceptance selector must survive the grammar change.
    expect(source).toContain('data-federation-context-id={federation.federationId}');
  });

  it('uses the prototype 12px item rhythm, 13px name, 7px dot and 12px muted desc', () => {
    expect(rule('.sk-federation-list .sk-settings-item')).toContain('margin-top: 12px');
    expect(rule('.sk-federation-row')).toContain('gap: 12px');
    expect(rule('.sk-federation-id')).toContain('gap: 8px');
    expect(rule('.sk-federation-id strong')).toContain('font-size: 13px');
    const dot = rule('.sk-federation-id i');
    expect(dot).toContain('width: 7px');
    expect(dot).toContain('height: 7px');
    expect(dot).toContain('background: #2f9e5e');
    expect(rule('.sk-federation-id i[data-active=\'0\']')).toContain(
      'background: var(--pt-muted)',
    );
    const desc = rule('.sk-federation-desc');
    expect(desc).toContain('font-size: 12px');
    expect(desc).toContain('color: var(--pt-muted)');
  });

  it('uses the prototype field hint for the empty list, not a Text component', () => {
    expect(source).toContain('<p className="sk-field-hint">');
    expect(source).not.toContain("tone=\"secondary\">{t('settings.federation.contexts.empty')}");
    expect(rule('.sk-field-hint')).toContain('font-size: 12px');
  });
});
