import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'package:peers_touch_mobile/pages/actor/auth_page.dart';
import 'package:peers_touch_mobile/pages/actor/auth_wrapper.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

import 'package:get/get.dart';

import 'l10n/app_localizations.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:get_storage/get_storage.dart';
import 'package:peers_touch_mobile/features/home/home_module.dart';

void main() async {
  // Ensure Flutter is initialized
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize GetStorage
  await GetStorage.init();

  // Initialize ControllerManager to ensure all controllers are ready
  ControllerManager();

  // Initialize auth service and load saved data
  await ControllerManager.authService.init();

  // Register the method channel early
  const MethodChannel platform = MethodChannel('samples.flutter.dev/storage');

  // Set up a method call handler to ensure the channel is registered
  platform.setMethodCallHandler((call) async {
    // This is just to ensure the channel is registered
    return null;
  });

  // Try to make a call to initialize the channel, but ignore errors
  try {
    await platform.invokeMethod('getFreeDiskSpace').catchError((error) {
      // Ignore errors during initialization
      appLogger.debug('Method channel initialization error (expected): $error');
    });
  } catch (e) {
    // Ignore errors during initialization
    appLogger.debug('Method channel initialization exception (expected): $e');
  }

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      // Changed from MaterialApp
      title: 'Peers Touch',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('en'), // English
        Locale('zh'), // Chinese
      ],
      home: const AuthWrapper(),
      getPages: [
        ...HomeModule.pages,
        GetPage(name: '/auth', page: () => const AuthPage()),
      ],
    );
  }
}

