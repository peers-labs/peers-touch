import 'dart:convert';
import 'package:flutter/services.dart';

class AppLocalizations {
  final Map<String, String> _localizedStrings;

  AppLocalizations(this._localizedStrings);

  static Future<AppLocalizations> load(String langCode) async {
    String jsonString = await rootBundle.loadString('lib/l10n/app_$langCode.arb');
    Map<String, dynamic> jsonMap = json.decode(jsonString);
    Map<String, String> localizedStrings = jsonMap.map((key, value) {
      return MapEntry(key, value.toString());
    });
    return AppLocalizations(localizedStrings);
  }

  String? translate(String key) {
    return _localizedStrings[key];
  }
}