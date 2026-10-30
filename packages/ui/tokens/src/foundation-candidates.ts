/**
 * UI-F01 design exploration. UI Identity owns promotion; none of these values
 * may be consumed as an accepted theme. getUITokens/tokenVariables do not use this.
 */
const neutralLight = {
  canvas: '#f5f5f3', surface: '#ffffff', subtle: '#eeefec', raised: '#ffffff',
  text: '#232725', secondary: '#616661', muted: '#6d736d',
  primary: '#315cb2', onPrimary: '#ffffff', primarySubtle: '#eaf0fa',
  border: '#dde0da', borderStrong: '#a9afa7',
  success: '#2f7051', warning: '#8a591e', danger: '#ae3a36',
};
const neutralDark = {
  canvas: '#161817', surface: '#202320', subtle: '#292e29', raised: '#333933',
  text: '#f0f2ec', secondary: '#b5bcb3', muted: '#a4aea1',
  primary: '#a4c0ff', onPrimary: '#172d54', primarySubtle: '#25364e',
  border: '#414840', borderStrong: '#626e60',
  success: '#98d2b1', warning: '#e5bd7d', danger: '#f1a39b',
};
type Palette = typeof neutralLight;

export interface FoundationCandidate {
  id: 'clear' | 'warm' | 'precise';
  name: string;
  subtitle: string;
  intent: string;
  status: 'draft';
  allowedUse: 'specimen-review';
  specRef: string;
  palette: { light: Palette; dark: Palette };
  geometry: {
    controlRadius: number; surfaceRadius: number; avatarRatio: number;
    inset: number; rowGap: number; iconStroke: number;
    title: number; body: number; lineHeight: number; tracking: string;
  };
}

export const foundationCandidates: readonly FoundationCandidate[] = [
  {
    id: 'clear', name: '清晰', subtitle: 'Clear', intent: '内容优先，边界退后。',
    status: 'draft', allowedUse: 'specimen-review',
    specRef: 'docs/architecture/platform/client/ui-system/prototype/foundations.md',
    palette: { light: neutralLight, dark: neutralDark },
    geometry: { controlRadius: 8, surfaceRadius: 12, avatarRatio: .22,
      inset: 24, rowGap: 16, iconStroke: 1.65, title: 28, body: 15, lineHeight: 1.8, tracking: '-.035em' },
  },
  {
    id: 'warm', name: '温和', subtitle: 'Warm', intent: '舒展阅读，靠近共同创作。',
    status: 'draft', allowedUse: 'specimen-review',
    specRef: 'docs/architecture/platform/client/ui-system/prototype/foundations.md',
    palette: {
      light: { ...neutralLight, canvas: '#f5f1eb', surface: '#fffcf7', subtle: '#eee6dc',
        text: '#302b25', secondary: '#6e6459', muted: '#7b6d5f', primary: '#955136',
        primarySubtle: '#f5e5d9', border: '#ded3c5', borderStrong: '#b9a995', raised: '#fffcf7' },
      dark: { ...neutralDark, canvas: '#1d1915', surface: '#29231d', subtle: '#342c23',
        text: '#f4eee4', secondary: '#c5b9a9', muted: '#b4a593', primary: '#e8b597',
        onPrimary: '#402313', primarySubtle: '#493225', border: '#504337',
        borderStrong: '#74604d', raised: '#3b3027' },
    },
    geometry: { controlRadius: 10, surfaceRadius: 16, avatarRatio: .26,
      inset: 26, rowGap: 18, iconStroke: 1.8, title: 28, body: 15, lineHeight: 1.9, tracking: '-.025em' },
  },
  {
    id: 'precise', name: '精密', subtitle: 'Precise', intent: '稳定轨道，清楚组织。',
    status: 'draft', allowedUse: 'specimen-review',
    specRef: 'docs/architecture/platform/client/ui-system/prototype/foundations.md',
    palette: {
      light: { ...neutralLight, canvas: '#edf1f0', surface: '#f9fcfb', subtle: '#e3eae7',
        text: '#1d322c', secondary: '#526960', muted: '#64776f', primary: '#28644f',
        primarySubtle: '#e2f0e9', border: '#cddbd4', borderStrong: '#9aafa3', raised: '#f9fcfb' },
      dark: { ...neutralDark, canvas: '#121d19', surface: '#1b2a23', subtle: '#23372d',
        text: '#eaf3ed', secondary: '#b0c6b7', muted: '#9eb4a5', primary: '#9ed7b8',
        onPrimary: '#153625', primarySubtle: '#294738', border: '#3c5948',
        borderStrong: '#5f7c68', raised: '#2c4034' },
    },
    geometry: { controlRadius: 6, surfaceRadius: 8, avatarRatio: .18,
      inset: 22, rowGap: 12, iconStroke: 1.5, title: 26, body: 14, lineHeight: 1.75, tracking: '-.04em' },
  },
];

/** Scoped CSS proposal, deliberately separate from active tokenVariables(). */
export function foundationCandidateVariables(candidate: FoundationCandidate, mode: 'light' | 'dark'): Record<string, string> {
  const palette = candidate.palette[mode];
  const g = candidate.geometry;
  return {
    ...Object.fromEntries(Object.entries(palette).map(([key, value]) => [`--pt-${key}`, value])),
    '--pt-primaryHover': palette.primary,
    '--pt-focus': palette.primary,
    '--pt-radius-sm': `${g.controlRadius}px`,
    '--pt-radius-md': `${g.controlRadius}px`,
    '--pt-radius-lg': `${g.surfaceRadius}px`,
    '--pt-radius-xl': `${g.surfaceRadius}px`,
    '--fd-inset': `${g.inset}px`,
    '--fd-gap': `${g.rowGap}px`,
    '--fd-title': `${g.title}px`,
    '--fd-body': `${g.body}px`,
    '--fd-leading': String(g.lineHeight),
    '--fd-tracking': g.tracking,
    '--pt-shadow-float': mode === 'dark' ? '0 12px 30px #00000055' : '0 10px 28px #18251c18',
  };
}
