import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'binding/setting_binding.dart';
import 'controller/setting_controller.dart';
import 'view/setting_page.dart';

class SettingsModule {
  static void register() {
    // Register binding
    SettingsBinding().dependencies();

    // Register menu item
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'settings',
      label: 'Settings',
      icon: Icons.settings,
      isHead: false, // Bottom area
      order: 100, 
      contentBuilder: (context) => SettingPage(controller: Get.find<SettingController>()),
      toDIsplayPageTitle: false,
    ));
  }
}