import { getDesignTokens, type DesignThemeMode } from './tokens';

export function createAntdTokenTheme(mode: DesignThemeMode) {
  const token = getDesignTokens(mode);

  return {
    token: {
      colorPrimary: token.color.brand,
      colorInfo: token.color.brand,
      colorSuccess: token.color.success,
      colorWarning: token.color.warning,
      colorError: token.color.danger,
      colorBgBase: token.color.canvas,
      colorBgContainer: token.color.surface,
      colorBgElevated: token.color.surfaceRaised,
      colorText: token.color.textPrimary,
      colorTextSecondary: token.color.textSecondary,
      colorTextTertiary: token.color.textMuted,
      colorBorder: token.color.border,
      colorBorderSecondary: token.color.border,
      borderRadius: token.radius.md,
      borderRadiusLG: token.radius.xl,
      fontFamily: token.font.sans,
      controlHeight: 44,
    },
    components: {
      Button: {
        borderRadius: token.radius.md,
        controlHeight: 44,
        fontWeight: 600,
      },
      Input: {
        borderRadius: token.radius.md,
        controlHeight: 44,
      },
      Card: {
        borderRadiusLG: token.radius.xl,
      },
      List: {
        paddingContentHorizontalLG: 0,
      },
    },
  } as const;
}
