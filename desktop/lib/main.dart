import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

import 'app/bindings/initial_binding.dart';
import 'app/i18n/translation_service.dart';
import 'app/routes/app_pages.dart';
import 'app/routes/app_routes.dart';
import 'app/theme/app_theme.dart';
import 'core/constants/app_constants.dart';

import 'package:get_storage/get_storage.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await GetStorage.init();
  runApp(const App());
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      title: AppConstants.appName,
      // 同时保留 GetX 翻译服务（兼容历史），并接入 Flutter 官方本地化
      translations: TranslationService(),
      locale: const Locale('zh', 'CN'),
      fallbackLocale: TranslationService.fallbackLocale,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: AppLocalizations.supportedLocales,
      initialBinding: InitialBinding(),
      getPages: AppPages.pages,
      initialRoute: AppRoutes.shell,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
    );
  }
}