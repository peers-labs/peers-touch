import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/settings/view/setting_page.dart';

/// 设置模块 - 演示尾部区域注册
class SettingsModule {
  static void register() {
    // 注册到尾部区域（重要入口）
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'settings',
      label: '设置',
      icon: Icons.settings,
      isHead: false,   // 尾部区域
      order: 100,      // 尾部区域内的排序
      contentBuilder: (context) => const SettingsContentPage(),
    ));
  }
}

/// 设置内容页面
class SettingsContentPage extends StatelessWidget {
  const SettingsContentPage({super.key});

  @override
  Widget build(BuildContext context) {
    return GetBuilder<SettingController>(
      init: SettingController(),
      builder: (controller) {
        return SettingPage(controller: controller);
      },
    );
  }
}