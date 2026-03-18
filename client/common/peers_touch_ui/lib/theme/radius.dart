import 'package:flutter/material.dart';

class AppRadius {
  AppRadius._();

  static const double xs = 4;
  static const double sm = 6;
  static const double md = 8;
  static const double lg = 12;
  static const double xl = 16;
  static const double xxl = 24;
  static const double xxxl = 32;
  static const double full = 9999;

  static BorderRadius get xsBorder => BorderRadius.circular(xs);
  static BorderRadius get smBorder => BorderRadius.circular(sm);
  static BorderRadius get mdBorder => BorderRadius.circular(md);
  static BorderRadius get lgBorder => BorderRadius.circular(lg);
  static BorderRadius get xlBorder => BorderRadius.circular(xl);
  static BorderRadius get xxlBorder => BorderRadius.circular(xxl);
  static BorderRadius get xxxlBorder => BorderRadius.circular(xxxl);
  static BorderRadius get fullBorder => BorderRadius.circular(full);

  static BorderRadius buttonRadius = mdBorder;
  static BorderRadius cardRadius = lgBorder;
  static BorderRadius inputRadius = mdBorder;
  static BorderRadius dialogRadius = xlBorder;
  static BorderRadius bottomSheetRadius = xxlBorder;
  static BorderRadius avatarRadius = fullBorder;
  static BorderRadius chipRadius = smBorder;
  static BorderRadius tagRadius = xsBorder;
  static BorderRadius tooltipRadius = smBorder;
}
