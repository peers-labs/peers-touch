import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/lobe_tokens.dart';

// 自定义颜色扩展
extension CustomColorScheme on ColorScheme {
  // 一级菜单栏背景色
  Color get primaryMenuBarBackground => const Color(0xFF202020);
  // 菜单项选中背景色
  Color get menuItemSelected => const Color(0xFF2E2E2E);
  // 头像/尾部区域背景色
  Color get avatarAreaBackground => const Color(0xFF202020);
  // 边框/分割线颜色
  Color get outlineVariant => const Color(0xFF2D2D2D);
}

class AppTheme {
  static ThemeData get light => ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF6A5AE0)),
        extensions: const [WeChatTokens.light, LobeTokens.light],
        useMaterial3: true,
      );

  static ThemeData get dark => ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B7AE6),
          brightness: Brightness.dark,
          // 基础颜色定义 - 使用新的Material 3 API
          surface: const Color(0xFF1A1A1A), // 主内容背景
          onSurface: const Color(0xFFE6E6E6), // 文本主色
        ),
        extensions: const [WeChatTokens.dark, LobeTokens.dark],
        useMaterial3: true,
      );
}