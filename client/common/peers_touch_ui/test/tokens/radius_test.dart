import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

void main() {
  group('AppRadius', () {
    test('radius values should be correct', () {
      expect(AppRadius.xs, equals(4));
      expect(AppRadius.sm, equals(6));
      expect(AppRadius.md, equals(8));
      expect(AppRadius.lg, equals(12));
      expect(AppRadius.xl, equals(16));
      expect(AppRadius.xxl, equals(24));
      expect(AppRadius.xxxl, equals(32));
      expect(AppRadius.full, equals(9999));
    });

    test('radius should be progressive', () {
      expect(AppRadius.xs, lessThan(AppRadius.sm));
      expect(AppRadius.sm, lessThan(AppRadius.md));
      expect(AppRadius.md, lessThan(AppRadius.lg));
      expect(AppRadius.lg, lessThan(AppRadius.xl));
      expect(AppRadius.xl, lessThan(AppRadius.xxl));
      expect(AppRadius.xxl, lessThan(AppRadius.xxxl));
    });

    test('border radius helpers should work', () {
      expect(AppRadius.xsBorder, isNotNull);
      expect(AppRadius.smBorder, isNotNull);
      expect(AppRadius.mdBorder, isNotNull);
      expect(AppRadius.lgBorder, isNotNull);
      expect(AppRadius.xlBorder, isNotNull);
      expect(AppRadius.xxlBorder, isNotNull);
      expect(AppRadius.xxxlBorder, isNotNull);
      expect(AppRadius.fullBorder, isNotNull);
    });

    test('component radius should be reasonable', () {
      expect(AppRadius.buttonRadius, equals(AppRadius.mdBorder));
      expect(AppRadius.cardRadius, equals(AppRadius.lgBorder));
      expect(AppRadius.inputRadius, equals(AppRadius.mdBorder));
    });
  });
}
