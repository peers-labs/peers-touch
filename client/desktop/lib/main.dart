import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_desktop/app/bindings/initial_binding.dart';
import 'package:peers_touch_desktop/app/initialization/app_initializer.dart';
import 'package:peers_touch_desktop/app/routes/app_pages.dart';
import 'package:peers_touch_desktop/app/theme/app_theme.dart';
import 'package:peers_touch_desktop/app/theme/scroll_behavior.dart';
import 'package:peers_touch_desktop/core/constants/app_constants.dart';

class MyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback = (X509Certificate cert, String host, int port) => true;
  }
}

void main() async {
  HttpOverrides.global = MyHttpOverrides();

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
      initialRoute: AppInitializer().initialRoute,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      scrollBehavior: const DesktopScrollBehavior(),
    );
  }
}
