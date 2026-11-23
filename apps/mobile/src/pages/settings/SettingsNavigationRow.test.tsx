import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UIProvider } from '@peers-touch/ui';
import { SettingsNavigationRow } from './SettingsNavigationRow';

const componentSource = readFileSync(
  new URL('./SettingsNavigationRow.tsx', import.meta.url),
  'utf8',
);
const northstarCss = readFileSync(
  new URL('../../app/mobile-northstar.css', import.meta.url),
  'utf8',
);

function renderRow() {
  return renderToStaticMarkup(
    <UIProvider theme="light">
      <SettingsNavigationRow
        actionId="me.setting.account-info"
        settingId="account-info"
        label="Account Info"
        description="Manage your identity"
        onActivate={() => undefined}
      />
    </UIProvider>,
  );
}

describe('SettingsNavigationRow peers-ui contract', () => {
  it('renders the library ListRow primitive instead of a hand-rolled button', () => {
    const markup = renderRow();
    expect(markup).toContain('pt-list-row');
    expect(markup).toContain('pt-list-row-main');
    expect(markup).toContain('pt-list-row-label');
    expect(markup).toContain('pt-list-row-control');
    // The chevron is a peers-ui Icon rendered inside the control zone.
    expect(markup).toMatch(/pt-list-row-control[\s\S]*<svg/);
    // No library Button chrome may wrap the row.
    expect(markup).not.toContain('pt-button');
  });

  it('keeps the acceptance and accessibility contracts on the row element', () => {
    const markup = renderRow();
    expect(markup).toContain('data-action-id="me.setting.account-info"');
    expect(markup).toContain('data-setting-id="account-info"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('Account Info');
    expect(markup).toContain('Manage your identity');
  });

  it('composes only peers-ui primitives with a keyboard press contract', () => {
    expect(componentSource).toMatch(/import\s*\{[^}]*ListRow[^}]*\}\s*from '@peers-touch\/ui'/);
    expect(componentSource).toMatch(/import\s*\{[^}]*\bIcon\b[^}]*\}\s*from '@peers-touch\/ui'/);
    expect(componentSource).not.toContain('Button');
    expect(componentSource).toContain("event.key === 'Enter'");
    expect(componentSource).toContain("event.key === ' '");
    expect(componentSource).toContain('onKeyDown={handleKeyDown}');
    // No app-owned layout classes: geometry belongs entirely to ListRow.
    expect(componentSource).not.toContain('mobile-setting-navigation');
    expect(componentSource).not.toContain('className=');
  });

  it('retired the hand-rolled navigation row CSS from the app stylesheet', () => {
    expect(northstarCss).not.toContain('.mobile-setting-navigation-row');
    expect(northstarCss).not.toContain('.mobile-setting-navigation-copy');
  });
});
