import 'package:flutter/material.dart';
import 'package:get/get.dart';

class LocaleController extends GetxController {
  var locale = const Locale('en').obs;

  void setLocale(Locale newLocale) {
    locale.value = newLocale;
  }

  String? translate(String key) {
    // This is a placeholder. In a real app, you would use a localization library.
    if (locale.value.languageCode == 'zh') {
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