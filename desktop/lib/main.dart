import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:peers_touch_desktop/app/i18n/generated/app_localizations.dart';

import 'app/bindings/initial_binding.dart';
import 'app/initialization/app_initializer.dart';
import 'app/routes/app_pages.dart';
import 'app/routes/app_routes.dart';
import 'app/theme/app_theme.dart';
import 'core/constants/app_constants.dart';

void main() async {
  // Use static method for unified initialization - more concise usage
  final initialized = await AppInitializer.init();
  
  if (!initialized) {
    // Initialization failed, use logging framework to record error information
    // In actual application, error page or popup can be displayed here
    // Since logging system is already initialized in AppInitializer, we can use it directly
    return;
  }
  
  runApp(const App());
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      title: AppConstants.appName,
      // Use Flutter official localization mechanism
      locale: const Locale('zh', 'CN'),
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
    );
  }
}