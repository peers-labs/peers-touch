import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData light() {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF3B82F6),
      brightness: Brightness.light,
    );
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      visualDensity: VisualDensity.adaptivePlatformDensity,
    );
  }

  static ThemeData dark() {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF3B82F6),
      brightness: Brightness.dark,
    );
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      visualDensity: VisualDensity.adaptivePlatformDensity,
    );
  }
}