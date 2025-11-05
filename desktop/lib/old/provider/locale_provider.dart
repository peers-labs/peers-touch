import 'package:flutter/material.dart';

class LocaleProvider extends ChangeNotifier {
  Locale _locale = const Locale('en');

  Locale get locale => _locale;

  void setLocale(Locale newLocale) {
    _locale = newLocale;
    notifyListeners();
  }

  String? translate(String key) {
    // This is a placeholder. In a real app, you would use a localization library.
    if (_locale.languageCode == 'zh') {
      switch (key) {
        case 'general':
          return '通用';
        case 'language':
          return '语言';
        default:
          return key;
      }
    }
    return key;
  }
}