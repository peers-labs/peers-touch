/**
 * Legacy color constants for existing prototype pages (Shell, Settings).
 * New/migrated pages should use `theme.useToken()` from antd ConfigProvider instead.
 * Kept for backward compatibility; values aligned with antd default + brand primary.
 */
import { getDesignTokens } from '../../../shared/design-tokens';

const light = getDesignTokens('light');

export const T = {
  primary: light.color.brand,
  primaryHover: light.color.brandHover,
  primarySoft: 'rgba(102,126,234,0.1)',
  primaryWash: light.color.surfaceSubtle,
  primaryWash2: '#eef1fb',
  primaryWash3: '#f0f2f9',
  primaryDisabled: '#cdd3f6',
  danger: light.color.danger,
  success: light.color.success,
  warning: light.color.warning,
  text: light.color.textPrimary,
  textSecondary: light.color.textSecondary,
  textTertiary: light.color.textMuted,
  textQuaternary: light.color.textMuted,
  border: light.color.border,
  borderSoft: light.color.borderStrong,
  bg: light.color.surface,
  navBg: '#fbfbfb',
  surface: light.color.surfaceSubtle,
  white: light.color.surface,
  fillQuaternary: 'rgba(0,0,0,0.02)',
  fillTertiary: '#f0f0f0',
  radiusSm: light.radius.sm,
  radiusMd: light.radius.md,
  radiusLg: light.radius.lg,
  shadowSm: light.shadow.soft,
  shadowMd: light.shadow.float,
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
