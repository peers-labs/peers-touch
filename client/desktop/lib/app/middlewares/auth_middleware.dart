import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

class AuthMiddleware extends GetMiddleware {
  @override
  int? get priority => 1;

  @override
  RouteSettings? redirect(String? route) {
    _checkTokenExists();
    return null;
  }

  void _checkTokenExists() {
    try {
      if (!Get.isRegistered<GlobalContext>()) {
        LoggingService.info('AuthMiddleware: GlobalContext not registered, redirecting to login');
        Get.offAllNamed(AppRoutes.login);
        return;
      }
      
      final gc = Get.find<GlobalContext>();
      final session = gc.currentSession;
      final token = session?['accessToken']?.toString();
      
      if (token == null || token.isEmpty) {
        LoggingService.info('AuthMiddleware: No token found in GlobalContext, redirecting to login');
        Get.offAllNamed(AppRoutes.login);
      }
    } catch (e) {
      LoggingService.error('AuthMiddleware: Error checking token: $e');
    }
  }
}
