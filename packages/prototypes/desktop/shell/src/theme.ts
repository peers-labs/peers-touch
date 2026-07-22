/**
 * Legacy color constants for existing prototype pages (Shell, Settings).
 * New/migrated pages should use `theme.useToken()` from antd ConfigProvider instead.
 * Kept for backward compatibility; values aligned with antd default + brand primary.
 */
export const T = {
  primary: '#6b5bd6',
  primaryHover: '#5a4bc5',
  primarySoft: 'rgba(110,91,214,0.1)',
  primaryWash: '#f3f1fb',
  primaryWash2: '#ece9fb',
  primaryWash3: '#eceaf6',
  primaryDisabled: '#d8d3fb',
  danger: '#ff4d4f',
  success: '#52c41a',
  warning: '#faad14',
  text: '#262626',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
  textQuaternary: '#bfbfbf',
  border: '#f0f0f0',
  borderSoft: '#e8e8e8',
  bg: '#ffffff',
  navBg: '#fbfbfb',
  surface: '#fafafa',
  white: '#ffffff',
  fillQuaternary: 'rgba(0,0,0,0.02)',
  radiusSm: 6,
  radiusMd: 8,
  radiusLg: 12,
  shadowSm: '0 1px 2px rgba(15,23,42,0.04)',
  shadowMd: '0 4px 18px rgba(15,23,42,0.04)',
} as const;

/**
 * Additional design-system color literals not covered by antd tokens.
 * Used by migrated prototype pages alongside `theme.useToken()`.
 */
export const PROTOTYPE_COLORS = {
  asideBg: '#fbfbfb',
  activeRosterBg: '#eef4ff',
  toggleHoverBg: '#f3f1fb',
} as const;
