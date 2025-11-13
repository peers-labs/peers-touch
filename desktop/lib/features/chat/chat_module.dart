import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';
import 'package:peers_touch_desktop/features/chat/chat_binding.dart';
import 'package:peers_touch_desktop/features/chat/view/chat_home_page.dart';

class ChatModule {
  static void register() {
    ChatBinding().dependencies();
    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'social_chat',
      label: '聊天',
      icon: Icons.forum,
      isHead: true,
      order: 110,
      contentBuilder: (context) => const ChatHomePage(),
      toDIsplayPageTitle: false,
    ));
  }
}