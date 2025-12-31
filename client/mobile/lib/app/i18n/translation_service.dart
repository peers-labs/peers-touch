import 'package:get/get.dart';
import 'package:peers_touch_mobile/app/i18n/en_us.dart';
import 'package:peers_touch_mobile/app/i18n/zh_cn.dart';

class TranslationService extends Translations {
  @override
  Map<String, Map<String, String>> get keys => <String, Map<String, String>>{
        'en_US': enUS,
        'zh_CN': zhCN,
      };
}