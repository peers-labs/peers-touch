import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/l10n/app_localizations.dart';
import 'package:get/get.dart';

/// Helper class to access app localizations easily throughout the app
class AppLocalizationsHelper {
  /// Get the current app localizations instance
  static AppLocalizations get current {
    final context = Get.context;
    if (context == null) {
      throw Exception('No context available for localization');
    }
    final localizations = AppLocalizations.of(context);
    if (localizations == null) {
      throw Exception('No localizations available for context');
    }
    return localizations;
  }
  
  /// Check if localizations are available
  static bool get isAvailable {
    try {
      final context = Get.context;
      return context != null && AppLocalizations.of(context) != null;
    } catch (e) {
      return false;
    }
  }
  
  /// Get localized string with fallback
  static String getLocalizedString(String Function(AppLocalizations) getter, String fallback) {
    try {
      if (isAvailable) {
        return getter(current);
      }
    } catch (e) {
      // If localization fails, return fallback
    }
    return fallback;
  }
}

/// Extension to make it easier to access localizations
extension LocalizationExtension on BuildContext {
  AppLocalizations? get l10n => AppLocalizations.of(this);
}

/// Global getter for easy access to localizations
AppLocalizations get l10n => AppLocalizationsHelper.current;