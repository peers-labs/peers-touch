import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_desktop/app/bindings/initial_binding.dart';
import 'package:peers_touch_desktop/app/initialization/app_initializer.dart';
import 'package:peers_touch_desktop/app/routes/app_pages.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';
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

class App extends StatefulWidget {
  const App({super.key});

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  StreamSubscription<LogoutReason>? _logoutSubscription;
  bool _isHandlingLogout = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _setupLogoutListener();
        try {
          final orch = Get.find<AppLifecycleOrchestrator>();
          orch.awaitReadyGate().then((snapshot) {
            final target = snapshot.initialRoute;
            final current = Get.currentRoute;
            // Only redirect if user is still on splash (hasn't navigated away
            // via login flow). If user already logged in and moved to /shell,
            // don't override their navigation.
            if (target.isNotEmpty && target != current && current == AppRoutes.splash) {
              Get.offAllNamed(target);
            }
          });
        } catch (_) {}
      }
    });
  }

  // MYQ: 为什么要把logout逻辑放main里，这是非常丑陋的设计
  // globalContext 会管理这些逻辑，main 里注入 globalContext 不就可以了吗？
  void _setupLogoutListener() {
    if (!Get.isRegistered<GlobalContext>()) return;
    
    final globalContext = Get.find<GlobalContext>();
    _logoutSubscription = globalContext.onLogoutRequested.listen((reason) {
      if (_isHandlingLogout) return;
      _isHandlingLogout = true;
      
      LoggingService.info('App: Handling logout event, reason=$reason');
      
      final message = globalContext.lastLogoutMessage ?? '请重新登录';
      
      // Show single snackbar
      Get.snackbar(
        '提示',
        message,
        snackPosition: SnackPosition.TOP,
        duration: const Duration(seconds: 2),
        backgroundColor: Get.theme.colorScheme.errorContainer,
        colorText: Get.theme.colorScheme.onErrorContainer,
      );
      
      // Clear session and navigate to login
      _performLogout();
    });
  }

  // MYQ: 为什么要把logout放main里，这是非常丑陋的设计
  Future<void> _performLogout() async {
    try {
      // Clear token
      if (Get.isRegistered<TokenProvider>()) {
        await Get.find<TokenProvider>().clear();
      }
      
      // Clear session
      if (Get.isRegistered<GlobalContext>()) {
        final ctx = Get.find<GlobalContext>();
        await ctx.setSession(null);
        ctx.clearProfile();
      }
      
      // Navigate to login after short delay
      await Future.delayed(const Duration(milliseconds: 500));
      Get.offAllNamed(AppRoutes.login);
      
      LoggingService.info('App: Navigated to login page after logout');
    } catch (e) {
      LoggingService.error('App: Error during logout: $e');
    } finally {
      // Reset flag after delay
      Future.delayed(const Duration(seconds: 1), () {
        _isHandlingLogout = false;
      });
    }
  }

  @override
  void dispose() {
    _logoutSubscription?.cancel();
    super.dispose();
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
