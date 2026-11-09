import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./DeviceLinkPanel.tsx', import.meta.url), 'utf8');
const northstarCss = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return northstarCss.match(new RegExp(`${escaped.replace(/\\ /g, '\\s+')}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

// The sign-in modal must not change size across QR / approval / finishing /
// complete / expired phases — dynamic height shifts cause visual "shake".
describe('DeviceLinkPanel stable modal geometry', () => {
  it('hosts every phase inside one fixed-height class-driven stage', () => {
    // 340 CSS px keeps the v15 compact reference (85 columns with quiet zone)
    // at 4 px modules, the independently decodable floor.
    expect(source).toContain('const qrBox = 340;');
    expect(source).toContain('className="sc-device-link-stage"');
    const stage = rule('.sc-device-link-stage');
    expect(stage).toContain('height: 340px');
    expect(stage).toContain('position: relative');
    for (const stageName of ['qr', 'approve', 'finishing', 'complete', 'expired']) {
      expect(source).toContain(`data-pt-device-link-stage="${stageName}"`);
    }
  });

  it('positions phases absolutely so only one ever affects layout', () => {
    const layer = rule('.sc-device-link-layer');
    expect(layer).toContain('position: absolute');
    expect(layer).toContain('inset: 0');
  });

  it('reserves the footer action slot to the real button height even when empty', () => {
    // Measured product button height is 36px; a smaller empty slot caused a
    // 4px modal grow on the complete phase (receiver-visible shake).
    expect(rule('.sc-device-link-footer')).toContain('height: 36px');
  });

  it('merges errors into the status line instead of adding a second shifting row', () => {
    expect(source).not.toContain('{error && <Typography.Text role="alert"');
    expect(source).toContain("role={error ? 'alert' : 'status'}");
    expect(source).toContain(
      "className={error ? 'sc-device-link-status is-error' : 'sc-device-link-status'}",
    );
  });
});

describe('DeviceLinkPanel north-star .sk-device-* grammar parity', () => {
  it('styles the QR tile, comparison code and decide row from classes, not inline styles', () => {
    expect(source).not.toContain('style=');
    expect(source).toContain('className="sc-device-link-qr"');
    expect(source).toContain('className="sc-device-link-code"');
    expect(source).toContain('className="sc-device-link-decide"');
  });

  it('uses the prototype 26px/.22em comparison code and 12.5px muted hint', () => {
    const code = rule('.sc-device-link-code');
    expect(code).toContain('font-size: 26px');
    expect(code).toContain('letter-spacing: .22em');
    expect(code).toContain('font-weight: 700');
    const hint = rule('.sc-device-link-hint');
    expect(hint).toContain('font-size: 12.5px');
    expect(hint).toContain('color: var(--pt-muted)');
    expect(rule('.sc-device-link-decide')).toContain('gap: 10px');
  });

  it('uses the prototype secondary compact start action with a 14px icon', () => {
    expect(source).toContain('emphasis="secondary"');
    expect(source).toContain('density="compact"');
    expect(source).toContain('iconId="smartphone" size={14}');
  });
});
