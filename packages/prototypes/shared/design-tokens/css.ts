import { getDesignTokens, type DesignThemeMode } from './tokens';

export type DesignTokenCssVariables = Record<`--pt-${string}`, string>;

export function createDesignTokenCssVariables(mode: DesignThemeMode): DesignTokenCssVariables {
  const token = getDesignTokens(mode);

  return {
    '--pt-action-primary': token.color.brand,
    '--pt-action-primary-hover': token.color.brandHover,
    '--pt-surface-canvas': token.color.canvas,
    '--pt-surface-base': token.color.surface,
    '--pt-surface-subtle': token.color.surfaceSubtle,
    '--pt-surface-raised': token.color.surfaceRaised,
    '--pt-surface-overlay': token.color.surfaceOverlay,
    '--pt-text-primary': token.color.textPrimary,
    '--pt-text-secondary': token.color.textSecondary,
    '--pt-text-muted': token.color.textMuted,
    '--pt-text-on-action': token.color.textOnBrand,
    '--pt-border-hairline': token.color.border,
    '--pt-border-strong': token.color.borderStrong,
    '--pt-trust-success': token.color.success,
    '--pt-trust-warning': token.color.warning,
    '--pt-action-danger': token.color.danger,
    '--pt-border-focus': token.color.focus,
    '--pt-chat-bubble-own': token.color.bubbleOwn,
    '--pt-chat-bubble-peer': token.color.bubblePeer,
    '--pt-radius-xs': `${token.radius.xs}px`,
    '--pt-radius-sm': `${token.radius.sm}px`,
    '--pt-radius-md': `${token.radius.md}px`,
    '--pt-radius-lg': `${token.radius.lg}px`,
    '--pt-radius-xl': `${token.radius.xl}px`,
    '--pt-radius-2xl': `${token.radius.xxl}px`,
    '--pt-radius-full': `${token.radius.full}px`,
    '--pt-space-2xs': `${token.space.xxs}px`,
    '--pt-space-xs': `${token.space.xs}px`,
    '--pt-space-sm': `${token.space.sm}px`,
    '--pt-space-md': `${token.space.md}px`,
    '--pt-space-lg': `${token.space.lg}px`,
    '--pt-space-xl': `${token.space.xl}px`,
    '--pt-shadow-soft': token.shadow.soft,
    '--pt-shadow-float': token.shadow.float,
    '--pt-motion-fast': `${token.motion.fast}ms`,
    '--pt-motion-normal': `${token.motion.normal}ms`,
    '--pt-motion-ease': token.motion.ease,
    '--pt-font-sans': token.font.sans,
    '--pt-font-mono': token.font.mono,
  };
}
