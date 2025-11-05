import 'package:peers_touch_desktop/page/ai/chat_list.dart';
import 'package:peers_touch_desktop/page/ai/chat_moment.dart';
import 'package:peers_touch_desktop/controller/sidebar_controller.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

class AIChatPage extends StatelessWidget {
  const AIChatPage({super.key});

  @override
  Widget build(BuildContext context) {
    final sidebarState = Get.find<SidebarController>();

    // 使用Row来布局，但确保每个子组件都有正确的约束
    return Obx(() => Row(
      children: [
        // 中间栏 - 聊天列表
        if (sidebarState.isMiddleColumnOpen.value)
          SizedBox(
            width: 300,
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(8.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Expanded( // 使用Expanded确保文本可以收缩
                        child: Text('Chats', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
                      ),
                      IconButton(
                        icon: const Icon(Icons.menu_open),
                        onPressed: () => sidebarState.toggleMiddleColumn(),
                        tooltip: 'Hide Chat List',
                      ),
                    ],
                  ),
                ),
                const Expanded(child: ChatListPage()),
              ],
            ),
          ),
        
        // 右侧 - 聊天详情
        Expanded(
          child: ChatMomentPage(chatId: 0), // 使用Expanded确保占据剩余空间
        ),
      ],
    ));
  }
}