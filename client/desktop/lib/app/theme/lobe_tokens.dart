import 'package:flutter/material.dart';

/// LobeChat 风格设计 tokens
class LobeTokens extends ThemeExtension<LobeTokens> {
  // 背景层级
  final Color bgLevel0; // 页面背景
  final Color bgLevel1; // 主内容区背景
  final Color bgLevel2; // 次级容器背景（侧栏/卡片）
  final Color bgLevel3; // 输入框/列表项背景

  // 文本与分隔
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color divider;

  // 品牌与状态
  final Color brandAccent; // LobeHub 紫色
  final Color menuSelected; // 列表选中态背景

  // 间距与圆角 - 更圆润、更宽松
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

  const LobeTokens({
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
  ThemeExtension<LobeTokens> copyWith({
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
    return LobeTokens(
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
  ThemeExtension<LobeTokens> lerp(ThemeExtension<LobeTokens>? other, double t) {
    if (other is! LobeTokens) return this;
    return LobeTokens(
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
      radiusSm: _lerpDouble(radiusSm, other.radiusSm, t),
      radiusMd: _lerpDouble(radiusMd, other.radiusMd, t),
      radiusLg: _lerpDouble(radiusLg, other.radiusLg, t),
      spaceXs: _lerpDouble(spaceXs, other.spaceXs, t),
      spaceSm: _lerpDouble(spaceSm, other.spaceSm, t),
      spaceMd: _lerpDouble(spaceMd, other.spaceMd, t),
      spaceLg: _lerpDouble(spaceLg, other.spaceLg, t),
      spaceXl: _lerpDouble(spaceXl, other.spaceXl, t),
      menuBarWidth: _lerpDouble(menuBarWidth, other.menuBarWidth, t),
      menuItemBoxRatio: _lerpDouble(menuItemBoxRatio, other.menuItemBoxRatio, t),
    );
  }

  static double _lerpDouble(double a, double b, double t) => a + (b - a) * t;

  // 预设：LobeHub 浅色
  static const LobeTokens light = LobeTokens(
    bgLevel0: Color(0xFFF7F8FA),
    bgLevel1: Color(0xFFFFFFFF),
    bgLevel2: Color(0xFFF3F4F6),
    bgLevel3: Color(0xFFF0F2F5),
    textPrimary: Color(0xFF1F2328),
    textSecondary: Color(0xFF57606A),
    textTertiary: Color(0xFF8B949E),
    divider: Color(0xFFE5E7EB),
    brandAccent: Color(0xFF6A5AE0),
    menuSelected: Color(0xFFEDEEF3),
    radiusSm: 10,
    radiusMd: 14,
    radiusLg: 18,
    spaceXs: 6,
    spaceSm: 10,
    spaceMd: 14,
    spaceLg: 20,
    spaceXl: 28,
    menuBarWidth: 64,
    menuItemBoxRatio: 0.618,
  );

  // 预设：LobeHub 暗色
  static const LobeTokens dark = LobeTokens(
    bgLevel0: Color(0xFF0F1115),
    bgLevel1: Color(0xFF15171C),
    bgLevel2: Color(0xFF1B1F24),
    bgLevel3: Color(0xFF21262D),
    textPrimary: Color(0xFFE6EDF3),
    textSecondary: Color(0xFF9AA7B2),
    textTertiary: Color(0xFF7D8790),
    divider: Color(0xFF2B3036),
    brandAccent: Color(0xFF8B7AE6),
    menuSelected: Color(0xFF262B33),
    radiusSm: 10,
    radiusMd: 14,
    radiusLg: 18,
    spaceXs: 6,
    spaceSm: 10,
    spaceMd: 14,
    spaceLg: 20,
    spaceXl: 28,
    menuBarWidth: 64,
    menuItemBoxRatio: 0.618,
  );
}