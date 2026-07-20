// Agent Prototype — Quiet Protocol Minimalism Design Tokens
// Aligned to Peers-Touch UI Identity system.

export const T = {
  surface: {
    canvas: '#ffffff',
    base: '#fafafa',
    subtle: '#f5f5f5',
    raised: '#fff',
  },
  text: {
    primary: '#262626',
    secondary: '#595959',
    muted: '#8c8c8c',
    quaternary: '#bfbfbf',
  },
  action: {
    primary: '#6b5bd6',
    primaryHover: '#5a4bc5',
    danger: '#ff4d4f',
  },
  border: {
    hairline: '#f0f0f0',
    focus: '#6b5bd6',
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
  },
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  trust: {
    success: '#52c41a',
    warning: '#faad14',
    error: '#ff4d4f',
  },
} as const;
