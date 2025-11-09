import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/ai_provider_settings.dart';
import 'package:peers_touch_desktop/features/ai_chat/ai_chat_binding.dart';
import 'package:peers_touch_desktop/features/ai_chat/view/ai_chat_page.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/constants/ai_constants.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';
import 'package:peers_touch_desktop/features/settings/model/setting_item.dart';

/// AI对话模块 - 演示模块自主注册和设置注入
class AIChatModule {
  static void register() {
    // 注入控制器依赖
    AIChatBinding().dependencies();
    // 注册到头部区域（业务功能）
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'ai_chat',
      label: 'AI对话',
      icon: Icons.chat,
      isHead: true,    // 头部区域
      order: 100,      // 头部区域内的排序
      contentBuilder: (context) => const AIChatPage(),
      toDIsplayPageTitle: false,
    ));
    
    // 注册AI Provider设置到全局设置管理器
    _registerAISettings();
  }
  
  /// 注册AI相关设置到全局设置管理器
   static void _registerAISettings() {
     // 延迟注册设置，确保设置控制器已初始化
     // 在实际应用中，这应该在应用启动后调用
     Future.delayed(const Duration(milliseconds: 100), () {
       try {
         // 尝试获取设置控制器
         final settingController = Get.find<SettingController>();
         
         // 注册AI Provider设置
         settingController.registerModuleSettings(
           'ai_provider',
           'AI服务提供商',
           AIProviderSettings.getSettings(),
         );

         // 注册完成后，自动拉取当前提供商的模型以用于默认模型的自动加载
         Future.microtask(() async {
           final storage = Get.find<LocalStorage>();
           final provider = storage.get<String>(AIConstants.providerType) ?? 'OpenAI';
           final service = AIServiceFactory.fromName(provider);
           try {
             final models = await service.fetchModels();
             settingController.updateSettingOptions('module_ai_provider', 'model_selection', models);
             final section = settingController.sections.firstWhere(
               (s) => s.id == 'module_ai_provider',
               orElse: () => settingController.sections.first,
             );
             final item = section.items.firstWhere(
               (i) => i.id == 'model_selection',
               orElse: () => const SettingItem(id: 'model_selection', title: '', type: SettingItemType.select),
             );
             final current = item.value?.toString();
             if (current != null && !models.contains(current)) {
               settingController.setItemError('module_ai_provider', 'model_selection', '当前选择的模型不在最新列表中');
             } else {
               settingController.setItemError('module_ai_provider', 'model_selection', null);
             }
             if (models.isNotEmpty && (current == null || !models.contains(current))) {
               settingController.updateSettingValue('module_ai_provider', 'model_selection', models.first);
               final key = provider == 'Ollama' ? AIConstants.selectedModelOllama : AIConstants.selectedModelOpenAI;
               storage.set(key, models.first);
             }
           } catch (_) {}
         });
       } catch (e) {
          // 设置控制器可能还未初始化，在实际应用中应该有更好的错误处理
          // print('设置控制器未找到，AI Provider设置注册失败: $e');
        }
     });
   }
}

// 旧占位页面已替换为正式 AIChatPage