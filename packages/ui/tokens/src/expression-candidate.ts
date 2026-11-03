/**
 * UI-F01 / complete material expression for Agent Groups. Draft proposal only.
 * Geometry and motion inherit active Peers tokens; no consumer theme promotion.
 */
export const expressionCandidate = {
  id: 'agent-material-expression',
  status: 'draft',
  allowedUse: 'specimen-review',
  specRef: 'docs/architecture/platform/client/ui-system/prototype/foundations.md',
} as const;

const light = {
  canvas: '#eff3ef', surface: '#fffefa', subtle: '#eff5f2', raised: '#ffffff',
  text: '#14241f', secondary: '#5d7169', muted: '#718079',
  primary: '#101d19', primaryHover: '#293c34', onPrimary: '#fffef6',
  primarySubtle: '#e1eee5', border: '#dce8e0', borderStrong: '#a0b8ad',
  focus: '#2e7160', success: '#2f715c',
};
const dark: typeof light = {
  canvas: '#1b2524', surface: '#2b3532', subtle: '#354340', raised: '#3a4743',
  text: '#f5f5e9', secondary: '#c1d0c8', muted: '#a9bcb2',
  primary: '#e9eedf', primaryHover: '#fffdf2', onPrimary: '#172921',
  primarySubtle: '#40584b', border: '#52665c', borderStrong: '#779c8a',
  focus: '#c9dfb2', success: '#b7d9ba',
};

export function expressionCandidateVariables(mode: 'light' | 'dark'): Record<string, string> {
  const isDark = mode === 'dark';
  return {
    ...Object.fromEntries(Object.entries(isDark ? dark : light).map(([key, value]) => [`--pt-${key}`, value])),
    '--as-accent': '#f1b023',
    '--as-accent-light': '#ffd67a',
    '--as-on-accent': '#33280e',
    '--as-ink': '#0c1d18',
    '--as-on-ink': '#fffef1',
    '--as-ink-secondary': '#c0cec2',
    '--as-ink-border': '#ffffff26',
    '--as-teal': isDark ? '#a3d1c3' : '#2e7164',
    '--as-teal-soft': isDark ? '#527c71' : '#acd2c3',
    '--as-preview': isDark ? '#304d45' : '#dfeee6',
    '--as-highlight': isDark ? '#e3f4d126' : '#ffffffd9',
    '--as-keyline': isDark ? '#d3e7d038' : '#ffffffed',
    '--as-paper': isDark ? '#3c4c43e8' : '#fffff7e8',
    '--as-glass': isDark ? '#779a8830' : '#ffffff65',
    '--as-shadow': isDark ? '0 10px 24px #060f133b' : '0 10px 24px #284b3814',
    '--as-float-shadow': isDark ? '0 14px 26px #04101444' : '0 14px 26px #2d52452a',
    '--as-bevel': isDark ? 'inset 0 1px 0 #efffd51f, inset 0 -1px 0 #030d1630' : 'inset 0 1px 0 #ffffff, inset 0 -1px 0 #bacbc32b',
    '--as-action': 'linear-gradient(155deg,#30483e 0%,#111d18 58%,#071510 100%)',
    '--as-action-hover': 'linear-gradient(155deg,#3e5d4e 0%,#223c30 68%,#142a20 100%)',
    '--as-stage': isDark
      ? 'radial-gradient(ellipse at 98% 0%,#4e727e55,transparent 60%),radial-gradient(ellipse at 0% 100%,#76694c22,transparent 50%),#222e2b'
      : 'radial-gradient(ellipse at 100% 0%,#bfdadadb,transparent 62%),radial-gradient(ellipse at 0% 100%,#ece8d4aa,transparent 52%),#faf9f0',
    '--as-panel': isDark
      ? 'linear-gradient(140deg,#34423bf7,#27342ef7)'
      : 'linear-gradient(140deg,#fffffffa,#fffff6f7)',
    '--as-field': isDark
      ? 'linear-gradient(110deg,#35473f,#394a46)'
      : 'linear-gradient(110deg,#edf6ee,#eaf3f1)',
    '--as-relation-surface': isDark
      ? 'radial-gradient(ellipse at 15% 0%,#467e7755,transparent 64%),radial-gradient(ellipse at 100% 100%,#b698523b,transparent 60%),linear-gradient(135deg,#3c6656,#2c4947)'
      : 'radial-gradient(ellipse at 10% 0%,#c6ece0,transparent 65%),radial-gradient(ellipse at 100% 100%,#f8dfa277,transparent 60%),linear-gradient(135deg,#e3efda,#bcdbd5)',
    '--as-review-surface': isDark
      ? 'radial-gradient(ellipse at 90% 12%,#779e8744,transparent 72%),linear-gradient(155deg,#395c51,#233d37)'
      : 'radial-gradient(ellipse at 90% 12%,#f7efc9aa,transparent 72%),linear-gradient(155deg,#d6eee2,#9fc9bf)',
    '--as-writing-surface': isDark
      ? 'radial-gradient(ellipse at 12% 0%,#a48f6355,transparent 70%),linear-gradient(135deg,#625a3b,#344a41)'
      : 'radial-gradient(ellipse at 12% 0%,#fffbea,transparent 70%),linear-gradient(135deg,#e6dfba,#ccdcca)',
    '--as-devops-surface': isDark
      ? 'radial-gradient(ellipse at 90% 0%,#789dab44,transparent 70%),linear-gradient(135deg,#425b61,#354945)'
      : 'radial-gradient(ellipse at 90% 0%,#ebf5ff,transparent 70%),linear-gradient(135deg,#d2e2e1,#aecacb)',
    '--as-selection': 'linear-gradient(110deg,#f4be36,#f0aa18)',
    '--as-warning-surface': isDark ? '#4b422b' : '#fbefd0',
    '--as-on-warning': isDark ? '#f4d895' : '#6b501a',
    '--as-danger-surface': isDark ? '#523b3b' : '#f8e8e4',
    '--as-font': '"Manrope", -apple-system, BlinkMacSystemFont, sans-serif',
  };
}
