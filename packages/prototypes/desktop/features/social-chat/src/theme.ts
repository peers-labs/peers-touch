/**
 * Design tokens for the social chat prototype.
 * Single source of truth for spacing, colors, typography, and layout constants.
 */
export const T = {
  // Brand
  primary: '#6b5bd6',
  primaryHover: '#5a4bc5',
  primaryActive: '#4a3cb4',

  // Surfaces
  bg: '#ffffff',
  bgElevated: '#ffffff',
  bgSubtle: '#fafafa',
  bgMuted: '#f5f5f5',
  bgHover: '#f0f0f0',
  bgActive: '#e8e8e8',

  // Text
  text: '#1a1a1a',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
  textQuaternary: '#bfbfbf',
  textOnPrimary: '#ffffff',
  textDanger: '#e53e3e',

  // Borders
  border: '#e8e8e8',
  borderSubtle: '#f0f0f0',

  // Semantic
  success: '#38a169',
  danger: '#e53e3e',
  dangerBg: '#fff5f5',
  warning: '#d69e2e',

  // Layout constants
  headerHeight: 56,
  sideNavWidth: 56,
  sessionListWidth: 320,
  sessionListCompactWidth: 248,
  detailPanelWidth: 320,
  chatReadableMinWidth: 420,
  chatSplitMinWidth: 760,

  // Spacing scale (4px base)
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 20,
  space6: 24,
  space8: 32,
  space10: 40,
  space12: 48,

  // Radius
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  radiusXl: 16,
  radiusFull: 9999,

  // Typography
  fontXs: 11,
  fontSm: 12,
  fontMd: 13,
  fontBase: 14,
  fontLg: 15,
  fontXl: 16,
  fontHeading: 18,

  // Shadows
  shadowSm: '0 1px 2px rgba(0,0,0,0.04)',
  shadowMd: '0 2px 8px rgba(0,0,0,0.08)',
  shadowLg: '0 4px 16px rgba(0,0,0,0.12)',

  // Context menu
  menuMinWidth: 180,
  menuItemHeight: 32,
  menuPadding: 4,
  menuRadius: 8,
  menuShadow: '0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
} as const;
