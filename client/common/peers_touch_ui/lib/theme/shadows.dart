import 'package:flutter/material.dart';

class AppShadows {
  AppShadows._();

  static List<BoxShadow> get xs => [
        BoxShadow(
          color: const Color(0x05000000),
          blurRadius: 2,
          offset: const Offset(0, 1),
          spreadRadius: 0,
        ),
      ];

  static List<BoxShadow> get sm => [
        BoxShadow(
          color: const Color(0x08000000),
          blurRadius: 3,
          offset: const Offset(0, 1),
          spreadRadius: 0,
        ),
        BoxShadow(
          color: const Color(0x03000000),
          blurRadius: 2,
          offset: const Offset(0, 1),
          spreadRadius: 0,
        ),
      ];

  static List<BoxShadow> get md => [
        BoxShadow(
          color: const Color(0x0A000000),
          blurRadius: 6,
          offset: const Offset(0, 2),
          spreadRadius: 0,
        ),
        BoxShadow(
          color: const Color(0x05000000),
          blurRadius: 4,
          offset: const Offset(0, 1),
          spreadRadius: 0,
        ),
      ];

  static List<BoxShadow> get lg => [
        BoxShadow(
          color: const Color(0x0D000000),
          blurRadius: 12,
          offset: const Offset(0, 4),
          spreadRadius: 0,
        ),
        BoxShadow(
          color: const Color(0x08000000),
          blurRadius: 6,
          offset: const Offset(0, 2),
          spreadRadius: 0,
        ),
      ];

  static List<BoxShadow> get xl => [
        BoxShadow(
          color: const Color(0x10000000),
          blurRadius: 20,
          offset: const Offset(0, 8),
          spreadRadius: -2,
        ),
        BoxShadow(
          color: const Color(0x0A000000),
          blurRadius: 10,
          offset: const Offset(0, 4),
          spreadRadius: 0,
        ),
      ];

  static List<BoxShadow> get xxl => [
        BoxShadow(
          color: const Color(0x14000000),
          blurRadius: 32,
          offset: const Offset(0, 12),
          spreadRadius: -4,
        ),
        BoxShadow(
          color: const Color(0x0D000000),
          blurRadius: 16,
          offset: const Offset(0, 6),
          spreadRadius: 0,
        ),
      ];

  static List<BoxShadow> get none => [];

  static List<BoxShadow> get card => sm;
  static List<BoxShadow> get cardHover => md;
  static List<BoxShadow> get dialog => lg;
  static List<BoxShadow> get dropdown => md;
  static List<BoxShadow> get tooltip => sm;
  static List<BoxShadow> get bottomSheet => xl;
  static List<BoxShadow> get modal => xxl;
}

class AppDarkShadows {
  AppDarkShadows._();

  static List<BoxShadow> get xs => [
        BoxShadow(
          color: const Color(0x1A000000),
          blurRadius: 2,
          offset: const Offset(0, 1),
        ),
      ];

  static List<BoxShadow> get sm => [
        BoxShadow(
          color: const Color(0x1F000000),
          blurRadius: 4,
          offset: const Offset(0, 1),
        ),
      ];

  static List<BoxShadow> get md => [
        BoxShadow(
          color: const Color(0x29000000),
          blurRadius: 8,
          offset: const Offset(0, 2),
        ),
      ];

  static List<BoxShadow> get lg => [
        BoxShadow(
          color: const Color(0x33000000),
          blurRadius: 16,
          offset: const Offset(0, 4),
        ),
      ];

  static List<BoxShadow> get xl => [
        BoxShadow(
          color: const Color(0x3D000000),
          blurRadius: 24,
          offset: const Offset(0, 8),
        ),
      ];

  static List<BoxShadow> get xxl => [
        BoxShadow(
          color: const Color(0x47000000),
          blurRadius: 32,
          offset: const Offset(0, 12),
        ),
      ];

  static List<BoxShadow> get card => md;
  static List<BoxShadow> get dialog => lg;
  static List<BoxShadow> get dropdown => lg;
  static List<BoxShadow> get tooltip => sm;
  static List<BoxShadow> get bottomSheet => xl;
  static List<BoxShadow> get modal => xxl;
}
