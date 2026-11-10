// Source-contract: the auth surface has two layout grammars. Wide windows keep
// the calm centered card; at the 480px phone floor the card flattens into the
// paper canvas and top-anchors, so the 360x480 startup window does not float a
// narrow card inside large bands of empty canvas. The desktop package has no
// DOM test environment, so these assertions pin the stylesheet contract.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../index.css', import.meta.url),
  'utf8',
);
const pageSource = readFileSync(
  new URL('./LoginPage.tsx', import.meta.url),
  'utf8',
);
const switcherSource = readFileSync(
  new URL('./StationSwitcher.tsx', import.meta.url),
  'utf8',
);

// Narrow block only: slice from the phone media query so base rules above it
// cannot satisfy the flattening assertions by accident.
const narrowBlock = stylesheet.slice(stylesheet.lastIndexOf('@media (max-width: 480px)'));

describe('auth desktop card grammar', () => {
  it('keeps the centered floating card above the phone breakpoint', () => {
    expect(stylesheet).toContain('.pt-auth-shell {');
    expect(stylesheet).toMatch(/\.pt-auth-shell\s*\{[^}]*padding: 24px/);
    expect(stylesheet).toContain('width: var(--pt-auth-card-width, 352px);');
    // Mid-range windows (481-760px) still center the card vertically.
    expect(stylesheet).toMatch(/@media \(max-width: 760px\)[\s\S]*?margin-block: auto/);
  });
});

describe('auth phone-narrow page grammar', () => {
  it('flattens card chrome into the paper canvas at <=480px', () => {
    expect(narrowBlock).toContain('@media (max-width: 480px)');
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?background: transparent/);
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?border: 0/);
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?box-shadow: none/);
  });

  it('top-anchors content with compact shell insets instead of centering', () => {
    expect(narrowBlock).toMatch(/\.pt-auth-shell\s*\{[\s\S]*?padding: 12px 16px/);
    expect(narrowBlock).toMatch(/\.pt-auth-card\s*\{[\s\S]*?margin-block: 0/);
    expect(narrowBlock).toContain('.pt-auth-region {');
    expect(narrowBlock).toContain('min-height: 0;');
  });

  it('tightens the internal vertical rhythm', () => {
    expect(narrowBlock).toContain('padding: 8px 4px 10px;');
    expect(narrowBlock).toContain('gap: 10px;');
    expect(narrowBlock).toContain('padding: 0 4px 12px;');
    expect(narrowBlock).toMatch(/\.pt-auth-back\s*\{[\s\S]*?margin: 0/);
    expect(narrowBlock).toContain('margin-top: 8px;');
  });
});

describe('auth surface structural hooks', () => {
  it('keeps the login card marker and footer Station switcher', () => {
    expect(pageSource).toContain('data-pt-login-card');
    expect(pageSource).toContain('<StationSwitcher />');
    // The switcher stays a popover trigger; the narrow redesign is CSS-only.
    expect(switcherSource).toContain('actionId="auth.station.switch"');
    expect(switcherSource).toContain('className="pt-auth-station-trigger"');
  });
});
