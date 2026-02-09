import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_desktop/app/bindings/initial_binding.dart';
import 'package:peers_touch_desktop/app/controller/app_controller.dart';
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
  
  // Initialize instance isolation BEFORE any storage operations.
  // PEERS_INSTANCE_ID isolates data directories for multi-instance testing.
  _initInstanceIsolation();

  final initialized = await AppInitializer.init();
  if (!initialized) {
    return;
  }

  runApp(const App());
}

/// Initialize instance isolation for multi-instance support.
/// Each instance with a different PEERS_INSTANCE_ID uses separate storage.
void _initInstanceIsolation() {
  // PEERS_INSTANCE_ID takes precedence, fallback to PEERS_DEV_USER
  final instanceId = Platform.environment['PEERS_INSTANCE_ID'] 
      ?? Platform.environment['PEERS_DEV_USER'];
  
  if (instanceId != null && instanceId.isNotEmpty) {
    // ignore: avoid_print
    print('[Instance] Isolating storage for instance: $instanceId');
    FileStorageManager.initInstanceId();
    SecureStorageImpl.setInstanceId(instanceId);
  }
}

/// App widget
/// StatelessWidget per project convention (ADR-002)
class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    // Initialize AppController for logout handling and lifecycle management
    Get.put(AppController());
    
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
