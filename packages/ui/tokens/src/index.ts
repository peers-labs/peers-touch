/** Concrete value owner. UI Identity owns the meanings and their policy. */
export { foundationCandidates, foundationCandidateVariables } from './foundation-candidates';
export type { FoundationCandidate } from './foundation-candidates';
export { expressionCandidate, expressionCandidateVariables } from './expression-candidate';
export { northStarTheme, northStarVariables } from './north-star-theme';

export const geometry = {
  radius: { xs: 4, sm: 8, md: 10, lg: 14, xl: 18, '2xl': 22, full: 999 },
  space: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 },
  control: { compact: 28, searchCompact: 34, row: 30, menu: 30, normal: 36, comfortable: 44 },
  composer: { radius: 12, inset: 6, collapsedRows: 1, expandedRows: 4, maximumRows: 10 },
  icon: { compact: 16, normal: 18, comfortable: 20 },
  font: {
    sans: "Manrope, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  typography: { body: 14, small: 12, heading2: 30, heading4: 20, strong: 600 },
  layer: { popup: 1000 },
  motion: {
    instant: 0, fast: 100, surface: 140, searchReveal: 160, normal: 200, slow: 300,
    searchFocus: 'cubic-bezier(.22,1,.36,1)',
    standard: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
    out: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
    emphasized: 'cubic-bezier(0.78, 0.14, 0.15, 0.86)',
    overshoot: 'cubic-bezier(0.12, 0.4, 0.29, 1.46)',
  },
} as const;
// Surface elevation contract (flat, no gradient separation):
//   canvas  recessed app floor; content cards lift off it tonally.
//   subtle  wells/fills (segmented control, tag, hover, code block).
//   surface resting cards/panels — separated from canvas by the tonal step,
//           a 1px hairline border, and shadow.rest.
//   raised  floating layers (menu/popover/toast/dialog) over surface; in light
//           it stays white because the lift reads via shadow.float + scrim,
//           while dark uses a real tonal lift.
// Never collapse the canvas↔surface tonal step: hairline + rest shadow alone
// are not enough on low-contrast (e.g. warm/neutral) palettes.
//
// North-star color contract (promoted from the confirmed desktop frame,
// docs/architecture/platform/client/ui-system/prototype/north-star-frame.md):
// Structured quiet surfaces + an ink action capsule + a single pine brand mark.
//   * primary  near-ink capsule (#1a1d20 / dark inverts) — dominant action,
//              selection, scope/data capsules. Wins by weight, not brand hue.
//   * accent   pine #2f6a50 — the ONLY brand chroma: identity/current-location,
//              connection and online points, accept/answer, favorite marks.
//              Small touch points only; never a canvas/card fill, never the
//              success color. Semantic success/warning/danger/info stay separate.
// Structural Expressive Minimalism and Quiet Protocol Minimalism are superseded
// by the north-star frame grammar (see the ui-system docs above).
const ink: Record<'light' | 'dark', { solid: string; hover: string; onSolid: string; subtle: string }> = {
  light: { solid: '#1a1d20', hover: '#2b2f33', onSolid: '#ffffff', subtle: 'rgba(26,29,32,0.08)' },
  dark: { solid: '#f1f3f2', hover: '#e2e8e4', onSolid: '#14171a', subtle: 'rgba(241,243,242,0.10)' },
};
// Pine brand accent. Light is the frame's #2f6a50; dark lifts the same hue so
// the connection mark stays legible on deep surfaces.
const pine: Record<'light' | 'dark', { solid: string; hover: string; on: string; subtle: string }> = {
  light: { solid: '#2f6a50', hover: '#35775b', on: '#ffffff', subtle: 'rgba(47,106,80,0.12)' },
  dark: { solid: '#5ea182', hover: '#6fb091', on: '#0e1a14', subtle: 'rgba(94,161,130,0.16)' },
};
const light = {
  canvas: '#f4f5f4', surface: '#ffffff', subtle: '#eef0f0', raised: '#ffffff',
  text: '#171a1c', secondary: '#5d6368', muted: '#8a9096',
  primary: ink.light.solid, primaryHover: ink.light.hover, onPrimary: ink.light.onSolid,
  primarySubtle: ink.light.subtle,
  border: 'rgba(22,26,24,0.10)', borderStrong: 'rgba(22,26,24,0.18)',
  // Brand accent follows the confirmed north-star pine skin. The success
  // foreground still clears AA 4.5 on surface and subtle wells (#1f7d52).
  accent: pine.light.solid, accentHover: pine.light.hover, onAccent: pine.light.on, accentSubtle: pine.light.subtle,
  success: '#1f7d52', warning: '#9a5f00', danger: '#c0392f', info: '#2469a8',
  successSubtle: '#eaf7ef', warningSubtle: '#fff5e1', dangerSubtle: '#fceeee', infoSubtle: '#eaf3fc', white: '#ffffff',
  focus: 'rgba(47,106,80,0.34)', scrim: 'rgba(17,20,18,0.40)',
  ownBubble: ink.light.solid, peerBubble: '#ffffff',
  overlay: '#ffffff',
  mediaStage: '#10131a', mediaStageSoft: '#1b1f29', mediaStageText: 'rgba(255,255,255,0.65)',
};
const dark: typeof light = {
  canvas: '#101211', surface: '#171b19', subtle: '#1f2421', raised: '#232926',
  text: '#f1f3f2', secondary: '#aeb6b1', muted: '#8f9792',
  primary: ink.dark.solid, primaryHover: ink.dark.hover, onPrimary: ink.dark.onSolid,
  primarySubtle: ink.dark.subtle,
  border: 'rgba(230,235,232,0.10)', borderStrong: 'rgba(230,235,232,0.20)',
  accent: pine.dark.solid, accentHover: pine.dark.hover, onAccent: pine.dark.on, accentSubtle: pine.dark.subtle,
  success: '#63c28f', warning: '#e2a54a', danger: '#ef7d73', info: '#7ab9ed',
  successSubtle: '#16382a', warningSubtle: '#3c2d14', dangerSubtle: '#402326', infoSubtle: '#1c304a', white: '#ffffff',
  focus: 'rgba(94,161,130,0.40)', scrim: 'rgba(0,0,0,0.60)',
  ownBubble: ink.dark.solid, peerBubble: '#232926',
  overlay: '#232926',
  mediaStage: '#10131a', mediaStageSoft: '#1b1f29', mediaStageText: 'rgba(255,255,255,0.65)',
};
export type UITokens = {
  color: typeof light;
  geometry: typeof geometry;
  // rest = content card on the recessed canvas; soft = toast / hover lift;
  // float = modal/popover/drawer above the whole page.
  shadow: { rest: string; soft: string; float: string };
};
export function getUITokens(mode: 'light' | 'dark'): UITokens {
  return {
    color: mode === 'dark' ? dark : light,
    geometry,
    shadow: mode === 'dark'
      ? {
          rest: '0 1px 2px rgba(0,0,0,0.30)',
          soft: '0 2px 12px rgba(0,0,0,0.24)',
          float: '0 16px 44px rgba(0,0,0,0.42)',
        }
      : {
          rest: '0 1px 2px rgba(20,24,22,0.05), 0 2px 8px -3px rgba(20,24,22,0.08)',
          soft: '0 4px 14px rgba(20,24,22,0.10)',
          float: '0 18px 48px -12px rgba(20,24,22,0.28)',
        },
  };
}
export function tokenVariables(mode: 'light' | 'dark'): Record<string, string> {
  const t = getUITokens(mode);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(t.color)) out[`--pt-${key}`] = value;
  for (const [key, value] of Object.entries(geometry.radius)) out[`--pt-radius-${key}`] = `${value}px`;
  for (const [key, value] of Object.entries(geometry.space)) out[`--pt-space-${key}`] = `${value}px`;
  for (const [key, value] of Object.entries(geometry.control)) out[`--pt-control-${key}`] = `${value}px`;
  out['--pt-composer-radius'] = `${geometry.composer.radius}px`;
  out['--pt-composer-inset'] = `${geometry.composer.inset}px`;
  for (const [key, value] of Object.entries(geometry.motion)) out[`--pt-motion-${key}`] = typeof value === 'number' ? `${value}ms` : value;
  out['--pt-font'] = geometry.font.sans;
  out['--pt-mono'] = geometry.font.mono;
  out['--pt-shadow-rest'] = t.shadow.rest;
  out['--pt-shadow-soft'] = t.shadow.soft;
  out['--pt-shadow-float'] = t.shadow.float;
  return out;
}
