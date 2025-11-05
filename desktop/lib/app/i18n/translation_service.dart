import 'package:get/get.dart';
import 'package:flutter/material.dart';

import 'en_us.dart';
import 'zh_cn.dart';

class TranslationService extends Translations {
  static const fallbackLocale = Locale('en', 'US');
  static const supportedLocales = [Locale('en', 'US'), Locale('zh', 'CN')];

  @override
  Map<String, Map<String, String>> get keys => {
        'en_US': enUs,
        'zh_CN': zhCn,
      };

  static void changeLocale(Locale locale) {
    if (supportedLocales.contains(locale)) {
      Get.updateLocale(locale);
    }
  }
}