import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
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
    LocalStorage().get<String>('auth_token').then((token) {
      if (token == null || token.isEmpty) {
        LoggingService.info('AuthMiddleware: No token found, redirecting to login');
        Get.offAllNamed(AppRoutes.login);
      }
    }).catchError((e) {
      LoggingService.error('AuthMiddleware: Error checking token: $e');
    });
  }
}
