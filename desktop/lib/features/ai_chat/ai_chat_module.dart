import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';
import './ai_provider_settings.dart';

/// AI对话模块 - 演示模块自主注册和设置注入
class AIChatModule {
  static void register() {
    // 注册到头部区域（业务功能）
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'ai_chat',
      label: 'AI对话',
      icon: Icons.chat,
      isHead: true,    // 头部区域
      order: 100,      // 头部区域内的排序
      contentBuilder: (context) => AIChatContentPage(),
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
       } catch (e) {
          // 设置控制器可能还未初始化，在实际应用中应该有更好的错误处理
          // print('设置控制器未找到，AI Provider设置注册失败: $e');
        }
     });
   }
}

/// AI对话内容页面 - 模块自己管理完整界面
class AIChatContentPage extends StatelessWidget {
  const AIChatContentPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // 二级导航栏 - 模块自己管理
        Container(
          width: 280, // 二级导航固定宽度
          decoration: const BoxDecoration(
            color: Color(0xFF252525),
            border: Border(right: BorderSide(color: Color(0xFF2D2D2D), width: 1)),
          ),
          child: Column(
            children: [
              // 顶部搜索区域
              Container(
                height: 120,
                color: const Color(0xFF2D2D2D),
                child: const Center(child: Text('AI对话导航', style: TextStyle(color: Colors.white))),
              ),
              // 会话列表
              Expanded(
                child: Container(
                  color: const Color(0xFF252525),
                  child: const Center(child: Text('会话列表', style: TextStyle(color: Colors.white))),
                ),
              ),
            ],
          ),
        ),
        
        // 主内容区 - 模块自己管理
        Expanded(
          child: Container(
            color: const Color(0xFF1A1A1A),
            child: Column(
              children: [
                // 标题栏
                Container(
                  height: 64,
                  color: const Color(0xFF252525),
                  child: const Center(child: Text('AI对话', style: TextStyle(color: Colors.white))),
                ),
                // 消息区域
                Expanded(
                  child: Container(
                    color: const Color(0xFF1A1A1A),
                    child: const Center(child: Text('消息区域', style: TextStyle(color: Colors.white))),
                  ),
                ),
                // 输入区域
                Container(
                  height: 120,
                  color: const Color(0xFF252525),
                  child: const Center(child: Text('输入区域', style: TextStyle(color: Colors.white))),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}