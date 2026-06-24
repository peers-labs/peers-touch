/**
 * Atelier — fixed color palette for the prototype surface.
 *
 * A small violet palette (SOLO-style identity) used directly as inline
 * style colors across the React + LobeUI/antd web prototype.
 */
export const C = {
  primary: '#6b5bd6',
  primarySoft: 'rgba(110,91,214,0.1)',
  primaryWash: '#f3f1fb',
  primaryWash2: '#ece9fb',
  primaryWash3: '#eceaf6',

  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',

  warningBg: '#fffbe6',
  warningBorder: '#ffe58f',

  text: '#262626',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
  textQuaternary: '#bfbfbf',

  border: '#f0f0f0',
  borderSoft: '#ececec',
  fillSecondary: '#f5f5f5',
  fillQuaternary: '#fafafa',
  bg: '#ffffff',

  white: '#ffffff',
} as const;

/** Role tag colors (was antd Tag color names). */
export const ROLE_COLOR: Record<string, string> = {
  GoalOwner: '#d48806',
  Architect: '#2f54eb',
  Planner: '#1677ff',
  Risk: '#cf1322',
  Supervisor: '#722ed1',
  Executor: '#08979c',
  Verifier: '#389e0d',
  Integrator: '#c41d7f',
  Historian: '#8c8c8c',
};

/** Negotiation stance label + color. */
export const STANCE: Record<string, { t: string; c: string }> = {
  proposal: { t: '提案', c: '#1677ff' },
  objection: { t: '反对', c: '#cf1322' },
  counter: { t: '折中', c: '#2f54eb' },
  signoff: { t: '签字', c: '#389e0d' },
};
