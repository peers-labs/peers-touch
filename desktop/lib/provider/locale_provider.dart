import 'package:desktop/service/app_localizations.dart';
import 'package:flutter/material.dart';

class LocaleProvider extends ChangeNotifier {
  Locale _locale = const Locale('en');
  AppLocalizations? _localizations;

  Locale get locale => _locale;
  AppLocalizations? get localizations => _localizations;

  Future<void> setLocale(Locale locale) async {
    if (_locale != locale) {
      _locale = locale;
      _localizations = await AppLocalizations.load(locale.languageCode);
      notifyListeners();
    }
  }

  String? translate(String key) {
    return _localizations?.translate(key);
  }
}