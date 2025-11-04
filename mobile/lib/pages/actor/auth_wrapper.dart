import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/pages/actor/auth_page.dart';
import 'package:peers_touch_mobile/main.dart';

class AuthWrapper extends StatelessWidget {
  const AuthWrapper({super.key});

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final authService = ControllerManager.authService;
      
      // Check if user is logged in
      if (authService.isLoggedIn.value) {
        // User is logged in, show main app
        return const MainScreen();
      } else {
        // User is not logged in, show auth page
        return const AuthPage();
      }
    });
  }
}