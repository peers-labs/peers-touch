import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';
import 'package:peers_touch_mobile/pages/me/me_user_profile_header.dart';
import 'package:peers_touch_mobile/pages/me/me_services_section.dart';
import 'package:peers_touch_mobile/pages/me/me_features_section.dart';
import 'package:peers_touch_mobile/pages/me/me_settings_section.dart';
import 'package:peers_touch_mobile/controller/me_controller.dart';

class MeHomePage extends StatelessWidget {
  MeHomePage({super.key}) {
    // Initialize controller if not already initialized
    if (!Get.isRegistered<MeController>()) {
      Get.put(MeController());
    }
  }

  // Static action options for floating action ball
  static List<FloatingActionOption> get actionOptions => [];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    
    return Scaffold(
      backgroundColor: colorScheme.surfaceContainer,
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            children: [
              const UserProfileHeader(),
              const SizedBox(height: 8),
              const ServicesSection(),
              const SizedBox(height: 8),
              const FeaturesSection(),
              const SizedBox(height: 8),
              const SettingsSection(),
            ],
          ),
        ),
      ),
    );
  }


}
