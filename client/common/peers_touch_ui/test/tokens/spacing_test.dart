import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

void main() {
  group('AppSpacing', () {
    test('spacing should follow 4px base unit', () {
      expect(AppSpacing.xxs % 4, equals(0));
      expect(AppSpacing.xs % 4, equals(0));
      expect(AppSpacing.sm % 4, equals(0));
      expect(AppSpacing.md % 4, equals(0));
      expect(AppSpacing.lg % 4, equals(0));
      expect(AppSpacing.xl % 4, equals(0));
      expect(AppSpacing.xxl % 4, equals(0));
      expect(AppSpacing.xxxl % 4, equals(0));
    });

    test('spacing should be progressive', () {
      expect(AppSpacing.xxs, lessThan(AppSpacing.xs));
      expect(AppSpacing.xs, lessThan(AppSpacing.sm));
      expect(AppSpacing.sm, lessThan(AppSpacing.md));
      expect(AppSpacing.md, lessThan(AppSpacing.lg));
      expect(AppSpacing.lg, lessThan(AppSpacing.xl));
      expect(AppSpacing.xl, lessThan(AppSpacing.xxl));
      expect(AppSpacing.xxl, lessThan(AppSpacing.xxxl));
    });

    test('base spacing values should be correct', () {
      expect(AppSpacing.xxs, equals(4));
      expect(AppSpacing.xs, equals(8));
      expect(AppSpacing.sm, equals(12));
      expect(AppSpacing.md, equals(16));
      expect(AppSpacing.lg, equals(24));
      expect(AppSpacing.xl, equals(32));
      expect(AppSpacing.xxl, equals(48));
      expect(AppSpacing.xxxl, equals(64));
    });

    test('component spacing should be reasonable', () {
      expect(AppSpacing.buttonPaddingHorizontal, greaterThan(0));
      expect(AppSpacing.buttonPaddingVertical, greaterThan(0));
      expect(AppSpacing.cardPadding, greaterThan(0));
      expect(AppSpacing.pagePadding, greaterThan(0));
    });
  });
}
