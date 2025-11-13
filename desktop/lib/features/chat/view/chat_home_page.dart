import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/shell/widgets/three_pane_scaffold.dart';
import 'package:peers_touch_desktop/features/chat/widgets/conversation_list.dart';
import 'package:peers_touch_desktop/features/chat/widgets/message_list.dart';
import 'package:peers_touch_desktop/features/chat/widgets/chat_input_bar.dart';
import 'package:peers_touch_desktop/features/chat/widgets/friend_search_panel.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_list_controller.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_thread_controller.dart';
import 'package:peers_touch_desktop/features/chat/controller/friend_search_controller.dart';

class ChatHomePage extends StatelessWidget {
  const ChatHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    Get.find<ChatListController>();
    Get.find<ChatThreadController>();
    Get.find<FriendSearchController>();
    return ShellThreePane(
      leftBuilder: (ctx) => const ConversationList(),
      centerBuilder: (ctx) => DefaultTabController(
        length: 2,
        child: Column(children: [
          const TabBar(tabs: [Tab(text: '对话'), Tab(text: '找好友')]),
          Expanded(
            child: TabBarView(children: [
              Column(children: const [
                Expanded(child: MessageList()),
                Divider(height: 1),
                Padding(padding: EdgeInsets.all(8), child: ChatInputBar()),
              ]),
              const Padding(padding: EdgeInsets.all(12), child: FriendSearchPanel()),
            ]),
          ),
        ]),
      ),
      leftProps: const PaneProps(width: 280, minWidth: 220, maxWidth: 360),
    );
  }
}