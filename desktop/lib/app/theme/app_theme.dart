import 'package:flutter/material.dart';

// 自定义颜色扩展
extension CustomColorScheme on ColorScheme {
  // 一级菜单栏背景色
  Color get primaryMenuBarBackground => const Color(0xFF252525);
  // 菜单项选中背景色
  Color get menuItemSelected => const Color(0xFF3A3A3A);
  // 头像/尾部区域背景色
  Color get avatarAreaBackground => const Color(0xFF2D2D2D);
  // 边框/分割线颜色
  Color get outlineVariant => const Color(0xFF2D2D2D);
}

class AppTheme {
  static ThemeData get light => ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      );

  static ThemeData get dark => ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.blue,
          brightness: Brightness.dark,
          // 基础颜色定义 - 使用新的Material 3 API
          surface: const Color(0xFF1A1A1A), // 主背景色
          onSurface: Colors.white, // 组件表面上的内容颜色
        ),
        useMaterial3: true,
      );
}