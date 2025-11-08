import 'package:flutter/material.dart';

/// WeChat 风格设计 tokens，集中管理暗黑模式的颜色、间距与圆角
class WeChatTokens extends ThemeExtension<WeChatTokens> {
  // 颜色层级（背景/表面）
  final Color bgLevel0; // 页面背景
  final Color bgLevel1; // 主内容区背景
  final Color bgLevel2; // 次级容器背景（侧栏、卡片）
  final Color bgLevel3; // 输入框/列表项背景

  // 文本与分隔
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color divider;

  // 品牌与状态
  final Color brandAccent; // 微信绿色
  final Color menuSelected; // 选中态背景

  // 间距与圆角
  final double radiusSm;
  final double radiusMd;
  final double radiusLg;
  final double spaceXs;
  final double spaceSm;
  final double spaceMd;
  final double spaceLg;
  final double spaceXl;

  // 布局尺寸（避免硬编码）
  final double menuBarWidth; // 一级菜单栏宽度
  final double menuItemBoxRatio; // 菜单按钮正方形占栏宽比例（例如 0.618）

  const WeChatTokens({
    required this.bgLevel0,
    required this.bgLevel1,
    required this.bgLevel2,
    required this.bgLevel3,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.divider,
    required this.brandAccent,
    required this.menuSelected,
    required this.radiusSm,
    required this.radiusMd,
    required this.radiusLg,
    required this.spaceXs,
    required this.spaceSm,
    required this.spaceMd,
    required this.spaceLg,
    required this.spaceXl,
    required this.menuBarWidth,
    required this.menuItemBoxRatio,
  });

  @override
  ThemeExtension<WeChatTokens> copyWith({
    Color? bgLevel0,
    Color? bgLevel1,
    Color? bgLevel2,
    Color? bgLevel3,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? divider,
    Color? brandAccent,
    Color? menuSelected,
    double? radiusSm,
    double? radiusMd,
    double? radiusLg,
    double? spaceXs,
    double? spaceSm,
    double? spaceMd,
    double? spaceLg,
    double? spaceXl,
    double? menuBarWidth,
    double? menuItemBoxRatio,
  }) {
    return WeChatTokens(
      bgLevel0: bgLevel0 ?? this.bgLevel0,
      bgLevel1: bgLevel1 ?? this.bgLevel1,
      bgLevel2: bgLevel2 ?? this.bgLevel2,
      bgLevel3: bgLevel3 ?? this.bgLevel3,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
      divider: divider ?? this.divider,
      brandAccent: brandAccent ?? this.brandAccent,
      menuSelected: menuSelected ?? this.menuSelected,
      radiusSm: radiusSm ?? this.radiusSm,
      radiusMd: radiusMd ?? this.radiusMd,
      radiusLg: radiusLg ?? this.radiusLg,
      spaceXs: spaceXs ?? this.spaceXs,
      spaceSm: spaceSm ?? this.spaceSm,
      spaceMd: spaceMd ?? this.spaceMd,
      spaceLg: spaceLg ?? this.spaceLg,
      spaceXl: spaceXl ?? this.spaceXl,
      menuBarWidth: menuBarWidth ?? this.menuBarWidth,
      menuItemBoxRatio: menuItemBoxRatio ?? this.menuItemBoxRatio,
    );
  }

  @override
  ThemeExtension<WeChatTokens> lerp(ThemeExtension<WeChatTokens>? other, double t) {
    if (other is! WeChatTokens) return this;
    return WeChatTokens(
      bgLevel0: Color.lerp(bgLevel0, other.bgLevel0, t)!,
      bgLevel1: Color.lerp(bgLevel1, other.bgLevel1, t)!,
      bgLevel2: Color.lerp(bgLevel2, other.bgLevel2, t)!,
      bgLevel3: Color.lerp(bgLevel3, other.bgLevel3, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      divider: Color.lerp(divider, other.divider, t)!,
      brandAccent: Color.lerp(brandAccent, other.brandAccent, t)!,
      menuSelected: Color.lerp(menuSelected, other.menuSelected, t)!,
      radiusSm: lerpDouble(radiusSm, other.radiusSm, t),
      radiusMd: lerpDouble(radiusMd, other.radiusMd, t),
      radiusLg: lerpDouble(radiusLg, other.radiusLg, t),
      spaceXs: lerpDouble(spaceXs, other.spaceXs, t),
      spaceSm: lerpDouble(spaceSm, other.spaceSm, t),
      spaceMd: lerpDouble(spaceMd, other.spaceMd, t),
      spaceLg: lerpDouble(spaceLg, other.spaceLg, t),
      spaceXl: lerpDouble(spaceXl, other.spaceXl, t),
      menuBarWidth: lerpDouble(menuBarWidth, other.menuBarWidth, t),
      menuItemBoxRatio: lerpDouble(menuItemBoxRatio, other.menuItemBoxRatio, t),
    );
  }

  static double lerpDouble(double a, double b, double t) => a + (b - a) * t;

  // 预设：暗黑（参考微信）
  static const WeChatTokens dark = WeChatTokens(
    bgLevel0: Color(0xFF121212),
    bgLevel1: Color(0xFF1A1A1A),
    bgLevel2: Color(0xFF202020),
    bgLevel3: Color(0xFF262626),
    textPrimary: Color(0xFFE6E6E6),
    textSecondary: Color(0xFF9E9E9E),
    textTertiary: Color(0xFF7A7A7A),
    divider: Color(0xFF2D2D2D),
    brandAccent: Color(0xFF07C160),
    menuSelected: Color(0xFF2E2E2E),
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,
    spaceXs: 4,
    spaceSm: 8,
    spaceMd: 12,
    spaceLg: 16,
    spaceXl: 24,
    menuBarWidth: 64,
    menuItemBoxRatio: 0.618,
  );

  // 预设：浅色（保持默认，便于统一读取）
  static const WeChatTokens light = WeChatTokens(
    bgLevel0: Color(0xFFF7F7F7),
    bgLevel1: Color(0xFFFFFFFF),
    bgLevel2: Color(0xFFF5F5F5),
    bgLevel3: Color(0xFFF0F0F0),
    textPrimary: Color(0xFF1F1F1F),
    textSecondary: Color(0xFF606060),
    textTertiary: Color(0xFF8C8C8C),
    divider: Color(0xFFE6E6E6),
    brandAccent: Color(0xFF07C160),
    menuSelected: Color(0xFFEAEAEA),
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,
    spaceXs: 4,
    spaceSm: 8,
    spaceMd: 12,
    spaceLg: 16,
    spaceXl: 24,
    menuBarWidth: 64,
    menuItemBoxRatio: 0.618,
  );
}