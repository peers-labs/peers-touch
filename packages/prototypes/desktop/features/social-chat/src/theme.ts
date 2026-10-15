/**
 * Design tokens for the social chat prototype.
 * Single source of truth for spacing, colors, typography, and layout constants.
 */
import { getDesignTokens } from '../../../../shared/design-tokens';

const light = getDesignTokens('light');

export const T = {
  // Brand
  primary: light.color.brand,
  primaryHover: light.color.brandHover,
  primaryActive: '#4658bd',
  // Canonical quiet fill behind primary icon actions (decision ✓ etc).
  primaryWash: light.color.surfaceSubtle,

  // Federated (cross-station) deviation cue. Quiet marker for a peer who lives
  // on another station: distinct from both the selection/brand purple and from
  // warning/danger red, so "from another network" never reads as selected or as
  // an error. See ui-identity trust-state "Deviation cue".
  federated: '#5b8def',

  // Surfaces
  bg: light.color.surface,
  bgElevated: light.color.surfaceRaised,
  bgSubtle: light.color.surfaceSubtle,
  bgMuted: light.color.canvas,
  bgHover: light.color.surfaceSubtle,
  bgActive: light.color.border,

  // Text
  text: light.color.textPrimary,
  textSecondary: light.color.textSecondary,
  textTertiary: light.color.textMuted,
  textQuaternary: light.color.textMuted,
  textOnPrimary: light.color.textOnBrand,
  textDanger: light.color.danger,

  // Borders
  border: light.color.borderStrong,
  borderSubtle: light.color.border,

  // Semantic
  success: light.color.success,
  danger: light.color.danger,
  dangerBg: '#fff5f5',
  warning: light.color.warning,

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
  radiusSm: light.radius.xs,
  radiusMd: light.radius.md,
  radiusLg: light.radius.lg,
  radiusXl: light.radius.xl,
  radiusFull: light.radius.full,

  // Typography
  fontXs: 11,
  fontSm: 12,
  fontMd: 13,
  fontBase: 14,
  fontLg: 15,
  fontXl: 16,
  fontHeading: 18,

  // Shadows
  shadowSm: light.shadow.soft,
  shadowMd: light.shadow.soft,
  shadowLg: light.shadow.float,

  // Context menu
  menuMinWidth: 180,
  menuItemHeight: 32,
  menuPadding: 4,
  menuRadius: 8,
  menuShadow: '0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
} as const;
