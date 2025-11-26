import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'chat_binding.dart';
import 'view/chat_page.dart';

class ChatModule {
  static void register() {
    // 注册依赖绑定
    ChatBinding().dependencies();

    // 注册到头部区域（业务功能）
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'chat_rtc',
      label: 'RTC聊天',
      icon: Icons.chat_bubble_outline,
      isHead: true,
      order: 101, 
      contentBuilder: (context) => const ChatPage(),
      toDIsplayPageTitle: false,
    ));
  }
}
