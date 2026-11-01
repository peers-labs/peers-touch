/** Concrete value owner. UI Identity owns the meanings and their policy. */
export { foundationCandidates, foundationCandidateVariables } from './foundation-candidates';
export type { FoundationCandidate } from './foundation-candidates';
export { expressionCandidate, expressionCandidateVariables } from './expression-candidate';
export { northStarTheme, northStarVariables } from './north-star-theme';

export const geometry = {
  radius: { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, full: 999 },
  space: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32 },
  control: { compact: 28, normal: 36, comfortable: 44 },
  icon: { compact: 16, normal: 18, comfortable: 20 },
  font: {
    sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  typography: { body: 14, small: 12, heading2: 30, heading4: 20, strong: 600 },
  layer: { popup: 1000 },
  motion: {
    instant: 0, fast: 100, normal: 200, slow: 300,
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
// Neutral-ink action primitive (UI Identity decision, 2026-10-30):
// Structured Expressive Minimalism reserves hue for *meaning* (success,
// warning, danger, info, trust.*). The dominant action therefore carries no
// brand hue — it is the same ink as primary text, so a CTA wins by weight and
// hierarchy, never by competing with a semantic color. `solid` is the single
// primitive referenced by text.primary, action.primary, focus, and the
// self-authored bubble; `subtle` backs selection/avatar/pressed fills.
// Light = dark ink on white; dark inverts to near-white fill with ink text.
const ink: Record<'light' | 'dark', { solid: string; hover: string; onSolid: string; subtle: string }> = {
  light: { solid: '#202431', hover: '#3a4154', onSolid: '#ffffff', subtle: '#e9ecf2' },
  dark: { solid: '#f1f3f8', hover: '#e2e7f0', onSolid: '#202431', subtle: '#2c323d' },
};
const light = {
  canvas: '#f3f5f8', surface: '#ffffff', subtle: '#f7f8fb', raised: '#ffffff',
  text: ink.light.solid, secondary: '#626979', muted: '#757d8c',
  primary: ink.light.solid, primaryHover: ink.light.hover, onPrimary: ink.light.onSolid,
  primarySubtle: ink.light.subtle, border: '#e5e8ef', borderStrong: '#cbd0da',
  // Success foreground must clear AA 4.5 not only on white/surface but on the
  // subtle wells where alerts/tags actually render (4.81/4.63); the prior
  // #25875a measured 4.48/4.21/4.06 and failed all three small-text cases.
  success: '#1f7d52', warning: '#9a5a00', danger: '#c63939', info: '#2469a8',
  successSubtle: '#eaf7ef', warningSubtle: '#fff5e1', dangerSubtle: '#fceeee', infoSubtle: '#eaf3fc', white: '#ffffff',
  focus: ink.light.solid, scrim: 'rgba(0,0,0,0.38)',
  ownBubble: ink.light.solid, peerBubble: '#ffffff',
  mediaStage: '#10131a', mediaStageSoft: '#1b1f29', mediaStageText: 'rgba(255,255,255,0.65)',
};
const dark: typeof light = {
  canvas: '#111318', surface: '#181b22', subtle: '#1f232c', raised: '#242832',
  text: ink.dark.solid, secondary: '#b1b7c4', muted: '#969daa',
  primary: ink.dark.solid, primaryHover: ink.dark.hover, onPrimary: ink.dark.onSolid,
  primarySubtle: ink.dark.subtle, border: '#2d323d', borderStrong: '#4a5261',
  success: '#63c28f', warning: '#e2a54a', danger: '#f07b7b', info: '#7ab9ed',
  successSubtle: '#173c2b', warningSubtle: '#3c2d14', dangerSubtle: '#402326', infoSubtle: '#1c304a', white: '#ffffff',
  focus: ink.dark.solid, scrim: 'rgba(0,0,0,0.6)',
  ownBubble: ink.dark.solid, peerBubble: '#242832',
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
          rest: '0 1px 2px rgba(32,36,49,0.05), 0 2px 6px -2px rgba(32,36,49,0.06)',
          soft: '0 2px 10px rgba(32,36,49,0.08)',
          float: '0 14px 40px rgba(32,36,49,0.18)',
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
  for (const [key, value] of Object.entries(geometry.motion)) out[`--pt-motion-${key}`] = typeof value === 'number' ? `${value}ms` : value;
  out['--pt-font'] = geometry.font.sans;
  out['--pt-mono'] = geometry.font.mono;
  out['--pt-shadow-rest'] = t.shadow.rest;
  out['--pt-shadow-soft'] = t.shadow.soft;
  out['--pt-shadow-float'] = t.shadow.float;
  return out;
}
