import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

void main() {
  group('AppColors', () {
    test('primary color should be correct', () {
      expect(AppColors.primary, const Color(0xFF8B5CF6));
    });

    test('primary hover should be darker than primary', () {
      final primaryHsl = HSLColor.fromColor(AppColors.primary);
      final hoverHsl = HSLColor.fromColor(AppColors.primaryHover);
      expect(hoverHsl.lightness, lessThan(primaryHsl.lightness));
    });

    test('primary active should be darker than primary hover', () {
      final hoverHsl = HSLColor.fromColor(AppColors.primaryHover);
      final activeHsl = HSLColor.fromColor(AppColors.primaryActive);
      expect(activeHsl.lightness, lessThan(hoverHsl.lightness));
    });

    test('text colors should have correct hierarchy', () {
      final primary = AppColors.textPrimary;
      final secondary = AppColors.textSecondary;
      final tertiary = AppColors.textTertiary;

      final primaryLuminance = primary.computeLuminance();
      final secondaryLuminance = secondary.computeLuminance();
      final tertiaryLuminance = tertiary.computeLuminance();

      expect(primaryLuminance, lessThan(secondaryLuminance));
      expect(secondaryLuminance, lessThan(tertiaryLuminance));
    });

    test('background colors should have correct hierarchy', () {
      final background = AppColors.background;
      final secondary = AppColors.backgroundSecondary;
      final tertiary = AppColors.backgroundTertiary;

      final backgroundLuminance = background.computeLuminance();
      final secondaryLuminance = secondary.computeLuminance();
      final tertiaryLuminance = tertiary.computeLuminance();

      expect(backgroundLuminance, greaterThan(secondaryLuminance));
      expect(secondaryLuminance, greaterThan(tertiaryLuminance));
    });

    test('status colors should be distinct', () {
      expect(AppColors.success, isNot(equals(AppColors.warning)));
      expect(AppColors.warning, isNot(equals(AppColors.error)));
      expect(AppColors.error, isNot(equals(AppColors.info)));
      expect(AppColors.info, isNot(equals(AppColors.success)));
    });
  });

  group('AppDarkColors', () {
    test('primary color should be lighter in dark mode', () {
      final lightPrimary = HSLColor.fromColor(AppColors.primary);
      final darkPrimary = HSLColor.fromColor(AppDarkColors.primary);
      expect(darkPrimary.lightness, greaterThan(lightPrimary.lightness));
    });

    test('background should be dark', () {
      final backgroundLuminance = AppDarkColors.background.computeLuminance();
      expect(backgroundLuminance, lessThan(0.5));
    });

    test('text primary should be light', () {
      final textLuminance = AppDarkColors.textPrimary.computeLuminance();
      expect(textLuminance, greaterThan(0.5));
    });
  });
}
