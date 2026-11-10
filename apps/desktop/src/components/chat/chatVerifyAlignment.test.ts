// Source-contract: the E2EE safety-number verification panel follows the
// north-star .sk-verify grammar — peers controls, mono safety-number tile,
// and the QR + fingerprint material row.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(
  new URL('./SafetyVerificationPanel.tsx', import.meta.url),
  'utf8',
);
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return chatCss.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('safety verification panel (north-star .sk-verify parity)', () => {
  it('builds actions from peers Buttons/Spin with no native form controls', () => {
    expect(panelSource).toMatch(/Button as PtButton/);
    expect(panelSource).toContain('<PtSpin');
    expect(panelSource).not.toMatch(/<button\b/);
    expect(panelSource).not.toMatch(/<input\b/);
    expect(panelSource).not.toMatch(/<select\b/);
  });

  it('renders the safety number as the prototype 12px mono r10 centered tile', () => {
    const number = rule('.sc-verify__number');
    expect(number).toContain('font-size: 12px');
    expect(number).toContain('letter-spacing: 0.4px');
    expect(number).toContain('padding: 10px 8px');
    expect(number).toContain('border-radius: 10px');
    expect(number).toContain('line-height: 1.9');
    expect(number).toContain('text-align: center');
    expect(number).toMatch(/font-family:[^;]*var\(--pt-mono/);
    expect(rule('.sc-verify__number-block')).toContain('gap: 6px');
  });

  it('lays out QR + fingerprints with the prototype rhythm and type scale', () => {
    const material = rule('.sc-verify__material');
    expect(material).toContain('gap: 12px');
    expect(material).toContain('align-items: flex-start');
    expect(rule('.sc-verify__fingerprints')).toContain('gap: 8px');
    expect(rule('.sc-verify__fingerprint')).toContain('gap: 3px');
    const code = rule('.sc-verify__fingerprint code');
    expect(code).toContain('font-size: 10.5px');
    expect(code).toContain('color: var(--pt-secondary)');
    expect(code).toContain('white-space: nowrap');
  });

  it('uses the 11.5/1.55 description and 8px action rhythm', () => {
    const desc = rule('.sc-verify__description');
    expect(desc).toContain('font-size: 11.5px');
    expect(desc).toContain('line-height: 1.55');
    expect(rule('.sc-verify')).toContain('gap: 8px');
    expect(rule('.sc-verify__actions')).toContain('gap: 8px');
  });
});
