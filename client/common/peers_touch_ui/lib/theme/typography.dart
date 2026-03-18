import 'package:flutter/material.dart';

class AppTypography {
  AppTypography._();

  static const String fontFamily = 'Inter';

  static const double fontSizeXxs = 8;
  static const double fontSizeXs = 10;
  static const double fontSizeSm = 12;
  static const double fontSizeMd = 14;
  static const double fontSizeLg = 16;
  static const double fontSizeXl = 20;
  static const double fontSizeXxl = 24;
  static const double fontSizeXxxl = 32;
  static const double fontSizeDisplay = 48;

  static const FontWeight fontWeightLight = FontWeight.w300;
  static const FontWeight fontWeightNormal = FontWeight.w400;
  static const FontWeight fontWeightMedium = FontWeight.w500;
  static const FontWeight fontWeightSemibold = FontWeight.w600;
  static const FontWeight fontWeightBold = FontWeight.w700;

  static const double lineHeightTight = 1.25;
  static const double lineHeightNormal = 1.5;
  static const double lineHeightRelaxed = 1.75;

  static const double letterSpacingTight = -0.5;
  static const double letterSpacingNormal = 0;
  static const double letterSpacingWide = 0.5;

  static TextStyle get display => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeDisplay,
        fontWeight: fontWeightBold,
        height: lineHeightTight,
        letterSpacing: letterSpacingTight,
      );

  static TextStyle get heading1 => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeXxxl,
        fontWeight: fontWeightBold,
        height: lineHeightTight,
        letterSpacing: letterSpacingTight,
      );

  static TextStyle get heading2 => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeXxl,
        fontWeight: fontWeightSemibold,
        height: lineHeightTight,
        letterSpacing: letterSpacingTight,
      );

  static TextStyle get heading3 => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeXl,
        fontWeight: fontWeightSemibold,
        height: lineHeightNormal,
      );

  static TextStyle get heading4 => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeLg,
        fontWeight: fontWeightSemibold,
        height: lineHeightNormal,
      );

  static TextStyle get bodyLarge => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeLg,
        fontWeight: fontWeightNormal,
        height: lineHeightNormal,
      );

  static TextStyle get body => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeMd,
        fontWeight: fontWeightNormal,
        height: lineHeightNormal,
      );

  static TextStyle get bodySmall => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeSm,
        fontWeight: fontWeightNormal,
        height: lineHeightNormal,
      );

  static TextStyle get labelLarge => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeMd,
        fontWeight: fontWeightMedium,
        height: lineHeightNormal,
      );

  static TextStyle get label => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeSm,
        fontWeight: fontWeightMedium,
        height: lineHeightNormal,
      );

  static TextStyle get labelSmall => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeXs,
        fontWeight: fontWeightMedium,
        height: lineHeightNormal,
      );

  static TextStyle get caption => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeXs,
        fontWeight: fontWeightNormal,
        height: lineHeightNormal,
      );

  static TextStyle get button => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeMd,
        fontWeight: fontWeightMedium,
        height: lineHeightNormal,
      );

  static TextStyle get buttonSmall => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeSm,
        fontWeight: fontWeightMedium,
        height: lineHeightNormal,
      );

  static TextStyle get buttonLarge => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeLg,
        fontWeight: fontWeightMedium,
        height: lineHeightNormal,
      );

  static TextStyle get input => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeMd,
        fontWeight: fontWeightNormal,
        height: lineHeightNormal,
      );

  static TextStyle get inputHint => const TextStyle(
        fontFamily: fontFamily,
        fontSize: fontSizeMd,
        fontWeight: fontWeightNormal,
        height: lineHeightNormal,
      );

  static TextStyle get code => const TextStyle(
        fontFamily: 'JetBrains Mono',
        fontSize: fontSizeSm,
        fontWeight: fontWeightNormal,
        height: lineHeightRelaxed,
      );
}
