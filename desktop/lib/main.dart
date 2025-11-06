import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

import 'app/bindings/initial_binding.dart';
import 'app/routes/app_pages.dart';
import 'app/routes/app_routes.dart';
import 'app/theme/app_theme.dart';
import 'core/constants/app_constants.dart';
import 'core/utils/window_options_manager.dart';

import 'package:get_storage/get_storage.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await GetStorage.init();
  
  // 初始化窗口管理器
  await WindowOptionsManager.initializeWindowManager();
  
  runApp(const App());
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      title: AppConstants.appName,
      // 使用Flutter官方本地化机制（绑定到Get.locale，支持运行时切换）
      locale: Get.locale ?? const Locale('zh', 'CN'),
      fallbackLocale: const Locale('en', 'US'),
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
      // 让主题模式跟随Get的状态，支持运行时切换
      themeMode: Get.isDarkMode ? ThemeMode.dark : ThemeMode.light,
    );
  }
}