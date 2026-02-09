import 'dart:async';

import 'package:get/get.dart';
import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';

/// App-level controller for logout handling and lifecycle management
/// Per ADR-002: All state managed via GetX Controller
class AppController extends GetxController {
  StreamSubscription<LogoutReason>? _logoutSubscription;
  bool _isHandlingLogout = false;
  
  @override
  void onInit() {
    super.onInit();
    _setupLogoutListener();
    _handleInitialRoute();
  }
  
  @override
  void onClose() {
    _logoutSubscription?.cancel();
    super.onClose();
  }
  
  void _handleInitialRoute() {
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
}
