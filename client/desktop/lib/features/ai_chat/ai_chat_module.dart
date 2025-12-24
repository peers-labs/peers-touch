import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/features/ai_chat/binding/ai_chat_binding.dart';
import 'package:peers_touch_desktop/features/ai_chat/view/ai_chat_page.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';

class AiChatModule {
  static void register() {
    // Register binding
    AIChatBinding().dependencies();

    // Register menu item
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'ai_chat',
      label: 'AI Chat',
      icon: Icons.chat_bubble_outline,
      isHead: true,
      order: 20, 
      contentBuilder: (context) => const AIChatPage(),
      toDIsplayPageTitle: false,
    ));
  }
}

// 旧占位页面已替换为正式 AIChatPage
