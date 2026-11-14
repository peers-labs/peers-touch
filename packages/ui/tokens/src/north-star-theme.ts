/**
 * North-star candidate theme — pine-on-neutral grammar.
 *
 * Status: candidate. It coexists with the canonical cold-ink theme in
 * index.ts and may ONLY be injected through a scoped UIProvider `style`;
 * production surfaces never consume it implicitly. The prototype frame and
 * the Frontend Eles boards opt into it; when the grammar is fully promoted,
 * these values move into getUITokens() and this file is retired.
 *
 * Color discipline (source of truth: "Pine 色彩哲学与用色边界" in
 * docs/architecture/platform/client/ui-system/prototype/north-star-frame.md):
 * the container is ~95% neutral paper/ash; pine (`--pt-accent`) is a SINGLE,
 * light-receiving brand punctuation used only at brand/connection/selection
 * touch points. It is never a canvas, card fill, or solid green border.
 * Primary CTA stays neutral ink. Hairlines are translucent neutral, never
 * tinted green. Semantic colors stay independent of the brand accent.
 */
export const northStarTheme = {
  id: 'north-star-pine-glass',
  status: 'candidate',
  allowedUse: 'prototype-specimen',
  specRef: 'docs/architecture/platform/client/ui-system/prototype/north-star-frame.md',
} as const;

const light = {
  // Neutral paper container (a bare whisper of warmth, no hue cast).
  canvas: '#f4f5f4',
  surface: '#ffffff',
  subtle: '#f6f7f6',
  raised: '#ffffff',
  text: '#171a1c',
  secondary: '#5d6368',
  muted: '#8a9096',
  // CTA ink stays neutral; hierarchy wins by weight, not brand hue.
  primary: '#1a1d20',
  primaryHover: '#353a3f',
  onPrimary: '#ffffff',
  primarySubtle: '#ecedee',
  // Translucent neutral hairlines (no green border).
  border: 'rgba(22,26,24,0.10)',
  borderStrong: 'rgba(22,26,24,0.18)',
  // Pine: single light-receiving brand punctuation (medium lightness, breathable).
  accent: '#2f6a50',
  accentHover: '#275843',
  onAccent: '#ffffff',
  accentSubtle: '#e7f1ec',
  // Independent semantic colors (pine is not the success color).
  success: '#1f7d52',
  warning: '#9a5f00',
  danger: '#c0392f',
  info: '#2f6b94',
  successSubtle: '#eaf7ef',
  warningSubtle: '#fbf3e2',
  dangerSubtle: '#fbeceb',
  infoSubtle: '#eaf1f8',
  white: '#ffffff',
  focus: '#1a1d20',
  scrim: 'rgba(16,18,17,0.36)',
  ownBubble: '#1a1d20',
  peerBubble: '#ffffff',
  mediaStage: '#131615',
  mediaStageSoft: '#1d211f',
  mediaStageText: 'rgba(255,255,255,0.66)',
};

const dark: typeof light = {
  canvas: '#141615',
  surface: '#1b1d1c',
  subtle: '#222524',
  raised: '#262928',
  text: '#eceeed',
  secondary: '#aab0ad',
  muted: '#858c88',
  primary: '#f2f4f2',
  primaryHover: '#e3e7e4',
  onPrimary: '#16181a',
  primarySubtle: '#2a2e2c',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  accent: '#71bb92',
  accentHover: '#8ac9a5',
  onAccent: '#0d1a12',
  accentSubtle: '#20342a',
  success: '#63c28f',
  warning: '#dcb46a',
  danger: '#e08178',
  info: '#7fb6dd',
  successSubtle: '#173c2b',
  warningSubtle: '#3a2f17',
  dangerSubtle: '#3d2322',
  infoSubtle: '#1c304a',
  white: '#ffffff',
  focus: '#f2f4f2',
  scrim: 'rgba(0,0,0,0.58)',
  ownBubble: '#f2f4f2',
  peerBubble: '#222524',
  mediaStage: '#101312',
  mediaStageSoft: '#1a1e1c',
  mediaStageText: 'rgba(255,255,255,0.66)',
};

/**
 * Glass material layer (Pine-on-neutral grammar).
 *
 * The palette above stays flat neutral paper; the glass tokens describe the
 * frosted *card* material that lifts content off that floor: translucent
 * fills over the paper, one backdrop-blur radius, a hairline border and a
 * top-lit inset plus a soft outer shadow. They are material roles, never
 * hue: pine still lives only on `--pt-accent` touch points.
 */
const glass = {
  light: {
    blur: '22px',
    // Resting content card / raised sheet.
    surface: 'rgba(255,255,255,0.68)',
    // Modal dialog over a dim scrim: near-opaque so form text keeps full
    // contrast (a .68 fill here reads muddy against the dark backdrop).
    surfaceModal: 'rgba(255,255,255,0.94)',
    // Secondary card one tonal step deeper (nav wells, nested panels).
    surfaceAlt: 'rgba(255,255,255,0.54)',
    // Subtle fill inside a glass card (segmented tracks, presses).
    tile: 'rgba(255,255,255,0.52)',
    border: 'rgba(22,26,24,0.09)',
    topLight: 'rgba(255,255,255,0.55)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 10px 30px -18px rgba(20,24,22,0.22)',
  },
  dark: {
    blur: '22px',
    surface: 'rgba(33,37,36,0.66)',
    surfaceModal: 'rgba(40,44,43,0.94)',
    surfaceAlt: 'rgba(28,32,31,0.60)',
    tile: 'rgba(40,44,43,0.55)',
    border: 'rgba(255,255,255,0.10)',
    topLight: 'rgba(255,255,255,0.06)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 12px 34px -18px rgba(0,0,0,0.55)',
  },
} as const;

// Pine grammar radius family (frame: control 12, avatar 11, card 20, sheet 22).
const radius = { xs: '5px', sm: '8px', md: '11px', lg: '16px', xl: '20px', '2xl': '22px' };

export type NorthStarMaterial = 'flat' | 'glass';

export function northStarVariables(
  mode: 'light' | 'dark' = 'light',
  options: { material?: NorthStarMaterial } = {},
): Record<string, string> {
  const palette = mode === 'dark' ? dark : light;
  const vars: Record<string, string> = Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [`--pt-${key}`, value]),
  );
  for (const [key, value] of Object.entries(radius)) vars[`--pt-radius-${key}`] = value;
  // Glass is the canonical north-star material: surfaces are frosted over
  // neutral paper. `material: 'flat'` falls back to opaque palette fills for
  // harnesses that need a non-translucent canvas.
  const material = options.material ?? 'glass';
  const g = mode === 'dark' ? glass.dark : glass.light;
  if (material === 'glass') {
    vars['--pt-surface'] = g.surface;
    vars['--pt-raised'] = g.surface;
    vars['--pt-subtle'] = g.tile;
  }
  vars['--pt-glass-blur'] = g.blur;
  vars['--pt-glass-surface'] = g.surface;
  // Modal surface frosts under glass, but stays fully opaque in flat mode.
  vars['--pt-glass-surface-modal'] = material === 'glass' ? g.surfaceModal : palette.raised;
  vars['--pt-glass-surface-alt'] = g.surfaceAlt;
  vars['--pt-glass-tile'] = g.tile;
  vars['--pt-glass-border'] = g.border;
  vars['--pt-glass-top-light'] = g.topLight;
  vars['--pt-glass-shadow'] = g.shadow;
  vars['--pt-font'] = 'Manrope, -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif';
  vars['--pt-shadow-rest'] = mode === 'dark'
    ? '0 1px 2px rgba(0,0,0,0.30)'
    : '0 1px 2px rgba(20,24,22,0.05), 0 2px 6px -2px rgba(20,24,22,0.06)';
  vars['--pt-shadow-soft'] = mode === 'dark'
    ? '0 2px 12px rgba(0,0,0,0.28)'
    : '0 8px 24px -14px rgba(20,24,22,0.20)';
  vars['--pt-shadow-float'] = mode === 'dark'
    ? '0 16px 44px rgba(0,0,0,0.48)'
    : '0 24px 64px -24px rgba(20,24,22,0.30), inset 0 1px 0 rgba(255,255,255,0.60)';
  return vars;
}
