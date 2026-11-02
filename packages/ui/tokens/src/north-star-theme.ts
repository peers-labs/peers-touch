/**
 * North-star candidate theme — the pine-glass grammar accepted through the
 * desktop/mobile prototype reviews.
 *
 * Status: candidate. It coexists with the canonical cold-ink theme in
 * index.ts and may ONLY be injected through a scoped UIProvider `style`;
 * production surfaces never consume it implicitly. The prototype frame and
 * the Frontend Eles boards opt into it; when the grammar is fully promoted,
 * these values move into getUITokens() and this file is retired.
 *
 * Source of truth: the reviewed --sk-* grammar in
 * packages/prototypes/shared/ui-system/design-directions.css (glass skin).
 * The frame uses translucent surfaces over a tinted canvas with per-surface
 * blur; the library needs solid companions (translucent components without
 * their own blur would leak content), so surface/subtle/raised here are the
 * opaque composites of white-glass over #dceade, while shadows/hairlines keep
 * the green-black cast.
 */
export const northStarTheme = {
  id: 'north-star-pine-glass',
  status: 'candidate',
  allowedUse: 'prototype-specimen',
  specRef: 'docs/architecture/platform/client/ui-system/prototype/self-training-methodology.md',
} as const;

const light = {
  canvas: '#dceade',
  surface: '#f3f8f4',
  subtle: '#ecf3ee',
  raised: '#f2f4f2',
  text: '#11201a',
  secondary: '#52605a',
  muted: '#7e8d85',
  primary: '#0d100d',
  primaryHover: '#2a332c',
  onPrimary: '#f3f8f4',
  primarySubtle: '#e7efe9',
  border: '#d3ddd6',
  borderStrong: '#a8bcb1',
  success: '#2f715c',
  warning: '#8a6210',
  danger: '#b0413a',
  info: '#3f6f8f',
  successSubtle: '#e1eee5',
  warningSubtle: '#fbf1dc',
  dangerSubtle: '#f7e7e4',
  infoSubtle: '#e6f0f5',
  white: '#ffffff',
  focus: '#0d100d',
  scrim: 'rgba(13,20,16,0.34)',
  ownBubble: '#0d100d',
  peerBubble: '#f8fbfa',
  mediaStage: '#102018',
  mediaStageSoft: '#1b2e25',
  mediaStageText: 'rgba(243,248,244,0.65)',
};

const dark: typeof light = {
  canvas: '#121a16',
  surface: '#1a2420',
  subtle: '#222d28',
  raised: '#25312b',
  text: '#e8f0ea',
  secondary: '#aebfb5',
  muted: '#889a8f',
  primary: '#f3f8f4',
  primaryHover: '#dbe7de',
  onPrimary: '#11201a',
  primarySubtle: '#2c3a33',
  border: '#32413a',
  borderStrong: '#516358',
  success: '#7fc7a4',
  warning: '#dcb46a',
  danger: '#e08d87',
  info: '#9cc2dc',
  successSubtle: '#1e352b',
  warningSubtle: '#3a2f17',
  dangerSubtle: '#3d231f',
  infoSubtle: '#1d3140',
  white: '#ffffff',
  focus: '#f3f8f4',
  scrim: 'rgba(0,0,0,0.58)',
  ownBubble: '#f3f8f4',
  peerBubble: '#222d28',
  mediaStage: '#0c1410',
  mediaStageSoft: '#16211b',
  mediaStageText: 'rgba(243,248,244,0.65)',
};

// Pine grammar radius family (frame: control 12, avatar 11, card 20).
const radius = { xs: '5px', sm: '8px', md: '11px', lg: '16px', xl: '20px' };

export function northStarVariables(mode: 'light' | 'dark' = 'light'): Record<string, string> {
  const palette = mode === 'dark' ? dark : light;
  const vars: Record<string, string> = Object.fromEntries(
    Object.entries(palette).map(([key, value]) => [`--pt-${key}`, value]),
  );
  for (const [key, value] of Object.entries(radius)) vars[`--pt-radius-${key}`] = value;
  vars['--pt-font'] = 'Manrope, -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif';
  vars['--pt-shadow-rest'] = mode === 'dark'
    ? '0 1px 2px rgba(0,0,0,0.30)'
    : 'inset 0 1px 0 rgba(255,255,255,0.55), 0 1px 2px rgba(28,60,48,0.05), 0 8px 24px -18px rgba(28,60,48,0.25)';
  vars['--pt-shadow-soft'] = mode === 'dark'
    ? '0 2px 12px rgba(0,0,0,0.28)'
    : '0 8px 24px -14px rgba(28,60,48,0.28)';
  vars['--pt-shadow-float'] = mode === 'dark'
    ? '0 16px 44px rgba(0,0,0,0.48)'
    : '0 24px 64px -24px rgba(16,32,24,0.38), inset 0 1px 0 rgba(255,255,255,0.50)';
  return vars;
}
