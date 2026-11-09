// Source-contract: account avatar/header uploads use the prototype corner
// action grammar (.sk-identity-avatar-action / .sk-banner-action): a peers
// IconButton revealed on hover/focus over a non-interactive image surface —
// never a fake role=button div covering the whole photo. The Tauri-native
// picker keeps these as IconButtons instead of <input> pickers.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AccountTab.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRe = /(?:^|\})([^{}]*)\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(stripped))) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2];
  }
  return '';
}

const codeSource = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('account identity image actions (north-star corner FilePicker parity)', () => {
  it('triggers uploads through peers IconButtons with stable action ids', () => {
    expect(source).toMatch(/<IconButton[\s\S]*?actionId="account\.avatar-change"[\s\S]*?iconId="edit"/);
    expect(source).toMatch(/<IconButton[\s\S]*?actionId="account\.header-change"[\s\S]*?iconId="edit"/);
    expect(source).toContain('data-pt-account-avatar-edit');
    expect(source).toContain('data-pt-account-header-edit');
  });

  it('keeps the image surfaces non-interactive (no role=button, no tabIndex)', () => {
    expect(codeSource).not.toContain('role="button"');
    expect(codeSource).not.toMatch(/sc-account-(avatar|banner)__surface[\s\S]{0,200}tabIndex/);
  });

  it('reveals actions with the prototype 0.24s soft-rise, including focus and touch', () => {
    const avatar = rule('.sc-account-avatar__action');
    expect(avatar).toContain('right: 6px');
    expect(avatar).toContain('bottom: 6px');
    expect(avatar).toContain('opacity: 0');
    expect(avatar).toContain('transform: translateY(3px)');
    expect(css).toContain('.sc-account-avatar:focus-within .sc-account-avatar__action');
    const banner = rule('.sc-account-banner__action');
    expect(banner).toContain('right: 12px');
    expect(banner).toContain('bottom: 12px');
    expect(banner).toContain('transform: translateY(4px)');
    expect(css).toContain('.sc-account-banner:focus-within .sc-account-banner__action');
    expect(css).toMatch(/@media \(hover: none\)[\s\S]*\.sc-account-avatar__action/);
  });
});

describe('account identity fields (north-star .sk-identity-field parity)', () => {
  it('renders label span, monospace code value and a 13px quiet copy IconButton in one row', () => {
    expect(source).toContain('className="sk-identity-field"');
    expect(source).toContain('data-pt-account-identity={identityKey}');
    expect(source).toMatch(/<span>\{label\}<\/span>/);
    expect(source).toMatch(/<code>[\s\S]*?\{value \|\| '—'\}[\s\S]*?<\/code>/);
    expect(source).toContain('iconSize={13}');
    expect(source).toContain('emphasis="quiet"');
    // The bespoke value tile and Text wrappers are gone.
    expect(source).not.toContain('sc-account-identity-field');
    expect(source).not.toContain('style={{ fontSize: 12 }}');
    expect(source).not.toContain('style={{ fontSize: 13');
  });

  it('uses the prototype 11.5px muted label, 12px code and 26px icon tile', () => {
    expect(rule('.sk-identity-field > span')).toContain('font-size: 11.5px');
    expect(rule('.sk-identity-field code')).toContain('font-size: 12px');
    const icon = rule('.sk-identity-field .pt-icon-button');
    expect(icon).toContain('width: 26px');
    expect(icon).toContain('height: 26px');
  });

  it('class-drives the saving footnote and empty-links hint', () => {
    expect(source).toContain('className="sc-account__saving"');
    expect(source).toContain('className="sk-field-hint"');
    expect(source).not.toContain('textAlign: \'right\'');
    expect(rule('.sc-account__saving')).toContain('text-align: right');
    expect(rule('.sc-account__saving')).toContain('font-size: 11px');
    expect(rule('.sk-field-hint')).toContain('font-size: 12px');
  });
});
