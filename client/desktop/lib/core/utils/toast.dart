import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class Toast {
  static void showSuccess(String message) {
    if (Get.context == null) return;
    final theme = Theme.of(Get.context!);
    
    Get.snackbar(
      'Success',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: theme.colorScheme.primaryContainer,
      colorText: theme.colorScheme.onPrimaryContainer,
      margin: EdgeInsets.all(UIKit.spaceMd(Get.context!)),
      borderRadius: UIKit.radiusMd(Get.context!),
      icon: Icon(Icons.check_circle, color: theme.colorScheme.onPrimaryContainer),
      duration: const Duration(seconds: 3),
    );
  }

  static void showError(String message) {
    if (Get.context == null) return;
    final theme = Theme.of(Get.context!);
    
    Get.snackbar(
      'Error',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: theme.colorScheme.errorContainer,
      colorText: theme.colorScheme.onErrorContainer,
      margin: EdgeInsets.all(UIKit.spaceMd(Get.context!)),
      borderRadius: UIKit.radiusMd(Get.context!),
      icon: Icon(Icons.error, color: theme.colorScheme.onErrorContainer),
      duration: const Duration(seconds: 4),
    );
  }

  static void showInfo(String message) {
    if (Get.context == null) return;
    final theme = Theme.of(Get.context!);
    
    Get.snackbar(
      'Info',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      colorText: theme.colorScheme.onSurfaceVariant,
      margin: EdgeInsets.all(UIKit.spaceMd(Get.context!)),
      borderRadius: UIKit.radiusMd(Get.context!),
      icon: Icon(Icons.info, color: theme.colorScheme.onSurfaceVariant),
      duration: const Duration(seconds: 3),
    );
  }
}
