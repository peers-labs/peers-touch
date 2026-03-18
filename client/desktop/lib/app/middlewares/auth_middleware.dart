import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

/// Route middleware that guards protected pages.
///
/// Uses GetMiddleware.redirect() correctly — returns a [RouteSettings]
/// to redirect when unauthenticated, instead of calling Get.offAllNamed()
/// which causes unpredictable navigation side-effects during route resolution.
class AuthMiddleware extends GetMiddleware {
  @override
  int? get priority => 1;

  @override
  RouteSettings? redirect(String? route) {
    try {
      if (!Get.isRegistered<GlobalContext>()) {
        LoggingService.info(
          'AuthMiddleware: GlobalContext not registered, redirecting to login',
        );
        return const RouteSettings(name: AppRoutes.login);
      }

      final gc = Get.find<GlobalContext>();
      final session = gc.currentSession;
      final token = session?['accessToken']?.toString();

      if (token == null || token.isEmpty) {
        LoggingService.info(
          'AuthMiddleware: No token found in GlobalContext, redirecting to login',
        );
        return const RouteSettings(name: AppRoutes.login);
      }
    } catch (e) {
      LoggingService.error('AuthMiddleware: Error checking token: $e');
      // On error, allow navigation rather than blocking the user
    }

    // Token exists — allow navigation to proceed
    return null;
  }
}
