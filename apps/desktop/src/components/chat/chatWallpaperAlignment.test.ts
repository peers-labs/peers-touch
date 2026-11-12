// Source-contract: per-conversation chat wallpaper must follow the north-star
// prototype's full-bleed ::before grammar (.sk-conv-view[data-chat-background])
// and its swatch picker (.sk-bg-picker / .sk-bg-swatch built on peers Toggle),
// rather than inline rgba washes or a native dropdown.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const messageAreaSource = readFileSync(new URL('./ChatMessageArea.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./ChatDetailPanel.tsx', import.meta.url), 'utf8');
const attachmentDetailCss = readFileSync(new URL('./attachmentDetail.css', import.meta.url), 'utf8');
const projectionSource = readFileSync(
  new URL('../../store/socialProjection.ts', import.meta.url),
  'utf8',
);

const PRESET_IDS = ['paper', 'mint', 'dusk', 'calm', 'graphite'] as const;

describe('chat wallpaper full-bleed grammar (north-star prototype parity)', () => {
  it('paints wallpaper on a full-bleed ::before layer, not inline element backgrounds', () => {
    expect(chatCss).toMatch(
      /\.sc-conversation\[data-chat-background\]:not\(\[data-chat-background='default'\]\)::before/,
    );
    expect(chatCss).toMatch(/position:\s*absolute;\s*inset:\s*0;\s*z-index:\s*0;/);
    // The legacy inline rgba wash helper must be gone.
    expect(messageAreaSource).not.toContain('chatBackgroundCss');
    expect(messageAreaSource).not.toMatch(/rgba\(255,\s*255,\s*255/);
    // Only the uploaded image passes through a CSS custom property.
    expect(messageAreaSource).toContain("'--sc-chat-bg-image'");
    expect(messageAreaSource).not.toContain('conversationSurfaceBackground');
  });

  it('uses the prototype-exact gradient stops for the shared preset ids', () => {
    const duskRule = chatCss.match(
      /\.sc-conversation\[data-chat-background='dusk'\]::before\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(duskRule).toContain('linear-gradient(135deg, #f6d8b8, #e7a98e 45%, #b08bb8)');

    const mintRule = chatCss.match(
      /\.sc-conversation\[data-chat-background='mint'\]::before\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(mintRule).toContain('linear-gradient(135deg, #cdeede, #a7d7cf 50%, #bcd0f2)');

    // Desktop "graphite" is the counterpart of the prototype "night" preset.
    const graphiteRule = chatCss.match(
      /\.sc-conversation\[data-chat-background='graphite'\]::before\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(graphiteRule).toContain('radial-gradient(120% 120% at 20% 0%, #3a4a63, #1c2536 70%)');
  });

  it('keeps every desktop preset id on the same wallpaper mechanism', () => {
    for (const id of PRESET_IDS) {
      expect(projectionSource).toContain(`'${id}'`);
      expect(chatCss).toContain(`.sc-conversation[data-chat-background='${id}']::before`);
      expect(chatCss).toContain(`.sc-bg-swatch[data-bg-preset='${id}']`);
    }
  });

  it('lets an uploaded image override any preset via the CSS variable', () => {
    const imageRules = chatCss.match(
      /\.sc-conversation\[data-chat-background-image\][^{]*\{[^}]*\}/g,
    ) ?? [];
    const overrideRule = imageRules.find((rule) => rule.includes('var(--sc-chat-bg-image)')) ?? '';
    expect(overrideRule).toContain("not([data-chat-background-image=''])");
  });

  it('picks wallpaper with peers Toggle swatches, not a Select dropdown', () => {
    expect(detailSource).toMatch(/Toggle as PtToggle/);
    expect(detailSource).toContain('className="sc-bg-picker"');
    expect(detailSource).toContain('data-bg-picker');
    expect(detailSource).toMatch(/<PtToggle[\s\S]*?data-bg-preset=\{value\}/);
    expect(detailSource).not.toContain('data-chat-background-select');
    // Swatch geometry mirrors .sk-bg-swatch.
    const swatchRule = chatCss.match(/\.pt-button\.sc-bg-swatch\s*\{[^}]*\}/)?.[0] ?? '';
    expect(swatchRule).toContain('width: 72px');
    expect(swatchRule).toContain('height: 56px');
    expect(swatchRule).toContain('border-radius: 12px');
    expect(chatCss).toMatch(/\.sc-bg-swatch\[aria-pressed='true'\][^}]*border-color:\s*var\(--pt-primary\)/);
  });
});

describe('group detail banner grammar (north-star neutral cover)', () => {
  it('paints the cover with a neutral ink wash, not a per-group hue', () => {
    const bannerRule = chatCss.match(/\.sc-detail__banner\s*\{[^}]*\}/)?.[0] ?? '';
    expect(bannerRule).toContain('color-mix(in srgb, var(--pt-primary) 14%, transparent)');
    expect(bannerRule).not.toMatch(/hsl\(/);
    // The deterministic hue helper and inline gradient must be gone.
    expect(detailSource).not.toContain('deterministicBannerHue');
    expect(detailSource).not.toMatch(/hsl\(/);
    // A token-driven veil keeps the blurred avatar legible.
    expect(chatCss).toMatch(
      /\.sc-detail__banner-veil\s*\{[^}]*color-mix\(in srgb, var\(--pt-text\)/,
    );
  });
});

describe('attachment detail host token discipline', () => {
  it('carries no hardcoded hex colors in the desktop bridge stylesheet', () => {
    // The shared client-chat-core package keeps its own fallback defaults for
    // mobile; inside .chat-file-modal the bridge variables always resolve, so
    // the antd-era blue/red hexes must not survive in the desktop layer.
    expect(attachmentDetailCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(attachmentDetailCss).not.toContain('1677ff');
    expect(attachmentDetailCss).not.toContain('cf1322');
    expect(attachmentDetailCss).toContain('color: var(--pt-danger)');
    expect(attachmentDetailCss).toContain('color: var(--pt-onPrimary)');
  });
});
