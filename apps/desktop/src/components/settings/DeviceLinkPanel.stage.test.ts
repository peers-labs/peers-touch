import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./DeviceLinkPanel.tsx', import.meta.url), 'utf8');

// The sign-in modal must not change size across QR / approval / finishing /
// complete / expired phases — dynamic height shifts cause visual "shake".
describe('DeviceLinkPanel stable modal geometry', () => {
  it('hosts every phase inside one fixed-height stage', () => {
    // 340 CSS px keeps the v15 compact reference (85 columns with quiet zone)
    // at 4 px modules, the independently decodable floor.
    expect(source).toContain('const qrBox = 340;');
    expect(source).toContain('const stageHeight = qrBox;');
    expect(source).toMatch(/<div style=\{\{ position: 'relative', height: stageHeight, width: '100%' \}\}>/);
    for (const stage of ['qr', 'approve', 'finishing', 'complete', 'expired']) {
      expect(source).toContain(`data-pt-device-link-stage="${stage}"`);
    }
  });

  it('positions phases absolutely so only one ever affects layout', () => {
    expect(source).toContain('position: \'absolute\'');
    expect(source).toContain('inset: 0');
  });

  it('reserves the footer action slot to the real button height even when empty', () => {
    // Measured product button height is 36px; a smaller empty slot caused a
    // 4px modal grow on the complete phase (receiver-visible shake).
    expect(source).toContain('height: 36');
  });

  it('merges errors into the status line instead of adding a second shifting row', () => {
    expect(source).not.toContain('{error && <Typography.Text role="alert"');
    expect(source).toContain('role={error ? \'alert\' : \'status\'}');
  });
});
