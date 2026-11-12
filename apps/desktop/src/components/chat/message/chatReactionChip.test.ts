import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rowSource = readFileSync(new URL('./ChatMessageRow.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../../ui/chat.css', import.meta.url), 'utf8');

describe('reaction chip north-star parity (.sk-msg-reaction)', () => {
  it('derives a per-emoji mine flag from the current viewer and marks the chip', () => {
    expect(rowSource).toContain('currentUserPtid');
    expect(rowSource).toMatch(/entry\.mine = true/);
    expect(rowSource).toContain('data-mine={mineByEmoji.get(emoji)');
    expect(rowSource).toContain('aria-pressed={mineByEmoji.get(emoji) ?? false}');
    expect(rowSource).toContain('sc-reaction-chip--mine');
  });

  it('uses accent-tinted pill chips with a solid accent mine state, no neutral fallback', () => {
    const chipRule = css.match(/\.sc-reaction-chip\s*\{[^}]*\}/)?.[0] ?? '';
    expect(chipRule).toContain('border-radius: 999px');
    expect(chipRule).toContain('color-mix(in srgb, var(--pt-primary) 14%, transparent)');
    expect(css).toMatch(/\.sc-reaction-chip--mine\s*\{[^}]*background:\s*var\(--pt-primary\)/);
    expect(css).toMatch(/\.sc-reaction-chip--mine\s*\{[^}]*color:\s*var\(--pt-onPrimary\)/);
    // The overflow "+N" chip stays neutral.
    expect(css).toMatch(/\.sc-reaction-chip--overflow\s*\{[^}]*var\(--pt-subtle\)/);
  });
});
