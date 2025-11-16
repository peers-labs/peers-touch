import 'package:flutter/material.dart';
import 'package:get/get.dart';

class SnackbarUtils {
  // Private constructor to prevent instantiation
  SnackbarUtils._();

  // Default snackbar configuration
  static const Duration _defaultDuration = Duration(seconds: 3);
  static const SnackPosition _defaultPosition = SnackPosition.BOTTOM;
  static const EdgeInsets _defaultMargin = EdgeInsets.all(16);
  static const BorderRadius _defaultBorderRadius = BorderRadius.all(Radius.circular(12));

  /// Show a success snackbar with green background
  static void showSuccess(
    String title,
    String message, {
    Duration? duration,
    SnackPosition? position,
    VoidCallback? onTap,
  }) {
    Get.snackbar(
      title,
      message,
      snackPosition: position ?? _defaultPosition,
      backgroundColor: const Color(0xFF4CAF50), // Material Green 500
      colorText: Colors.white,
      duration: duration ?? _defaultDuration,
      margin: _defaultMargin,
      borderRadius: _defaultBorderRadius.topLeft.x,
      icon: const Icon(
        Icons.check_circle,
        color: Colors.white,
        size: 24,
      ),
      shouldIconPulse: false,
      onTap: onTap != null ? (_) => onTap() : null,
      animationDuration: const Duration(milliseconds: 300),
    );
  }

  /// Show an error snackbar with red background
  static void showError(
    String title,
    String message, {
    Duration? duration,
    SnackPosition? position,
    VoidCallback? onTap,
  }) {
    Get.snackbar(
      title,
      message,
      snackPosition: position ?? _defaultPosition,
      backgroundColor: const Color(0xFFF44336), // Material Red 500
      colorText: Colors.white,
      duration: duration ?? _defaultDuration,
      margin: _defaultMargin,
      borderRadius: _defaultBorderRadius.topLeft.x,
      icon: const Icon(
        Icons.error,
        color: Colors.white,
        size: 24,
      ),
      shouldIconPulse: false,
      onTap: onTap != null ? (_) => onTap() : null,
      animationDuration: const Duration(milliseconds: 300),
    );
  }

  /// Show a warning snackbar with orange background
  static void showWarning(
    String title,
    String message, {
    Duration? duration,
    SnackPosition? position,
    VoidCallback? onTap,
  }) {
    Get.snackbar(
      title,
      message,
      snackPosition: position ?? _defaultPosition,
      backgroundColor: const Color(0xFFFF9800), // Material Orange 500
      colorText: Colors.white,
      duration: duration ?? _defaultDuration,
      margin: _defaultMargin,
      borderRadius: _defaultBorderRadius.topLeft.x,
      icon: const Icon(
        Icons.warning,
        color: Colors.white,
        size: 24,
      ),
      shouldIconPulse: false,
      onTap: onTap != null ? (_) => onTap() : null,
      animationDuration: const Duration(milliseconds: 300),
    );
  }

  /// Show an info snackbar with blue background
  static void showInfo(
    String title,
    String message, {
    Duration? duration,
    SnackPosition? position,
    VoidCallback? onTap,
  }) {
    Get.snackbar(
      title,
      message,
      snackPosition: position ?? _defaultPosition,
      backgroundColor: const Color(0xFF2196F3), // Material Blue 500
      colorText: Colors.white,
      duration: duration ?? _defaultDuration,
      margin: _defaultMargin,
      borderRadius: _defaultBorderRadius.topLeft.x,
      icon: const Icon(
        Icons.info,
        color: Colors.white,
        size: 24,
      ),
      shouldIconPulse: false,
      onTap: onTap != null ? (_) => onTap() : null,
      animationDuration: const Duration(milliseconds: 300),
    );
  }

  /// Show a custom snackbar with custom colors and icon
  static void showCustom(
    String title,
    String message, {
    required Color backgroundColor,
    Color textColor = Colors.white,
    IconData? icon,
    Duration? duration,
    SnackPosition? position,
    VoidCallback? onTap,
  }) {
    Get.snackbar(
      title,
      message,
      snackPosition: position ?? _defaultPosition,
      backgroundColor: backgroundColor,
      colorText: textColor,
      duration: duration ?? _defaultDuration,
      margin: _defaultMargin,
      borderRadius: _defaultBorderRadius.topLeft.x,
      icon: icon != null
          ? Icon(
              icon,
              color: textColor,
              size: 24,
            )
          : null,
      shouldIconPulse: false,
      onTap: onTap != null ? (_) => onTap() : null,
      animationDuration: const Duration(milliseconds: 300),
    );
  }

  /// Show a loading snackbar (typically used for ongoing operations)
  static void showLoading(
    String title,
    String message, {
    Duration? duration,
    SnackPosition? position,
  }) {
    Get.snackbar(
      title,
      message,
      snackPosition: position ?? _defaultPosition,
      backgroundColor: const Color(0xFF607D8B), // Material Blue Grey 500
      colorText: Colors.white,
      duration: duration ?? const Duration(seconds: 5),
      margin: _defaultMargin,
      borderRadius: _defaultBorderRadius.topLeft.x,
      icon: const SizedBox(
        width: 24,
        height: 24,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
        ),
      ),
      shouldIconPulse: false,
      animationDuration: const Duration(milliseconds: 300),
      showProgressIndicator: true,
      progressIndicatorBackgroundColor: Colors.white.withValues(alpha: 0.3),
      progressIndicatorValueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
    );
  }
}