import 'package:get/get.dart';
import 'en_us.dart';
import 'zh_cn.dart';

class TranslationService extends Translations {
  @override
  Map<String, Map<String, String>> get keys => <String, Map<String, String>>{
        'en_US': enUS,
        'zh_CN': zhCN,
      };
}