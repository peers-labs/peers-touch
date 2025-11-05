import 'package:peers_touch_desktop/controller/chat_moment_controller.dart';
import 'package:peers_touch_desktop/page/ai/chat_box.dart';
import 'package:peers_touch_desktop/controller/right_sidebar_controller.dart';
import 'package:peers_touch_desktop/widget/ai/chat_anchor_bar.dart';
import 'package:peers_touch_desktop/widget/ai/message_bubble.dart';
import 'package:peers_touch_desktop/widget/right_sidebar.dart';
import 'package:peers_touch_desktop/controller/sidebar_controller.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class ChatMomentPage extends StatelessWidget {
  final int chatId;

  const ChatMomentPage({super.key, required this.chatId});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(ChatMomentController());
    final sidebarState = Get.find<SidebarController>();
    final rightSidebarState = Get.find<RightSidebarController>();

    return Scaffold(
      appBar: AppBar(
        leading: Obx(() => sidebarState.isMiddleColumnOpen.value
            ? const SizedBox.shrink()
            : IconButton(
                icon: const Icon(Icons.menu),
                onPressed: () => sidebarState.toggleMiddleColumn(),
                tooltip: 'Show Chat List',
              )),
        title: const Text('Chat Session 1'),
        actions: [
          IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () {
              rightSidebarState.toggle();
            },
          ),
        ],
      ),
      body: Obx(() => Row(
            children: [
              Expanded(
                child: Column(
                  children: [
                    Expanded(
                      child: Row(
                        children: [
                          Expanded(
                            child: ListView.builder(
                              controller: controller.scrollController,
                              itemCount: 20, // Placeholder
                              itemBuilder: (context, index) {
                                return MessageBubble(
                                  message: 'Message $index',
                                  isMe: index % 2 == 0,
                                );
                              },
                            ),
                          ),
                          // 历史消息锚点，添加右边距避免顶格
                          Container(
                            margin: const EdgeInsets.only(right: 8.0),
                            child: ChatAnchorBar(controller: controller.scrollController, itemCount: 20),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (rightSidebarState.isOpen.value) const RightSidebar(),
            ],
          )),
      bottomNavigationBar: Padding(
        padding: const EdgeInsets.all(8.0),
        child: ChatBox(),
      ),
    );
  }
}