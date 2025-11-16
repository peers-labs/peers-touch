import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/services/setting_manager.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/ai_chat/ai_chat_binding.dart';
import 'package:peers_touch_desktop/features/ai_chat/view/ai_chat_page.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';
import 'package:peers_touch_desktop/features/ai_chat/view/provider_settings_page.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/provider_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';

/// AI对话模块 - 演示模块自主注册和设置注入
class AIChatModule {
  static void register() {
    // 注册依赖绑定
    AIChatBinding().dependencies();

    // 注册提供商服务到全局依赖注入
    Get.lazyPut<ProviderService>(() => ProviderService(), fenix: true);
    Get.lazyPut<ProviderController>(() => ProviderController(), fenix: true);

    // 注册到头部区域（业务功能）
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'ai_chat',
      label: 'AI对话',
      icon: Icons.chat,
      isHead: true, // 头部区域
      order: 100, // 头部区域内的排序
      contentBuilder: (context) => const AIChatPage(),
      toDIsplayPageTitle: false,
    ));

    // 注册AI提供商设置页面
    _registerProviderSettings();
  }

  /// 注册AI提供商设置
  static void _registerProviderSettings() {
    final settingManager = Get.find<SettingManager>();
    settingManager.registerSection(SettingSection(
      id: 'ai_provider',
      title: 'AI 服务商',
      page: const ProviderSettingsPage(),
    ));
  }
}

// 旧占位页面已替换为正式 AIChatPage