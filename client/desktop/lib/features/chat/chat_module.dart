import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/features/chat/binding/chat_binding.dart';
import 'package:peers_touch_desktop/features/chat/view/chat_page.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';

class ChatModule {
  static void register() {
    // Register binding
    ChatBinding().dependencies();

    // Register menu item
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'chat',
      label: 'Chat',
      icon: Icons.chat,
      isHead: true,
      order: 30, 
      contentBuilder: (context) => const ChatPage(),
      toDIsplayPageTitle: false,
    ));
  }
}
