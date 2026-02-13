import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/friend_chat/binding/friend_chat_binding.dart';
import 'package:peers_touch_desktop/features/friend_chat/view/friend_chat_page.dart';
import 'package:peers_touch_desktop/features/shell/manager/primary_menu_manager.dart';

class FriendChatModule {
  /// Shared reactive unread count for badge display
  static final RxInt totalUnreadCountRx = 0.obs;
  
  static void register() {
    FriendChatBinding().dependencies();

    PrimaryMenuManager.registerItem(PrimaryMenuItem(
      id: 'friend_chat',
      label: 'Messages',
      icon: Icons.forum_outlined,
      isHead: true,
      order: 25,
      contentBuilder: (context) => const FriendChatPage(),
      toDIsplayPageTitle: false,
      badgeCountRx: totalUnreadCountRx,
    ));
  }
}
