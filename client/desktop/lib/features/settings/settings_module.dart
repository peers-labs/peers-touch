import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/settings/binding/setting_binding.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/settings/view/setting_page.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';

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