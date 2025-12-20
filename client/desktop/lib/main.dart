import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';

import 'app/bindings/initial_binding.dart';
import 'app/initialization/app_initializer.dart';
import 'app/routes/app_pages.dart';
import 'app/routes/app_routes.dart';
import 'app/theme/app_theme.dart';
import 'core/constants/app_constants.dart';

void main() async {
  final initialized = await AppInitializer.init();
  if (!initialized) {
    return;
  }

  runApp(const App());
}

class App extends StatefulWidget {
  const App({super.key});

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        try {
          final orch = Get.find<AppLifecycleOrchestrator>();
          orch.awaitReadyGate().then((snapshot) {
            final target = snapshot.initialRoute;
            final current = Get.currentRoute;
            if (target.isNotEmpty && target != current) {
              Get.offAllNamed(target);
            }
          });
        } catch (_) {}
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      title: AppConstants.appName,
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
      initialRoute: AppRoutes.login,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
    );
  }
}
