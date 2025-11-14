import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_list_controller.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_thread_controller.dart';

class ConversationList extends StatelessWidget {
  const ConversationList({super.key});

  @override
  Widget build(BuildContext context) {
    final ctrl = Get.find<ChatListController>();
    return Obx(() {
      final items = ctrl.conversations;
      final selected = ctrl.selectedId.value;
      return ListView.separated(
        padding: EdgeInsets.all(UIKit.spaceSm(context)),
        itemCount: items.length,
        separatorBuilder: (ctx, _) => SizedBox(height: UIKit.spaceXs(ctx)),
        itemBuilder: (ctx, i) {
          final c = items[i];
          final isSelected = c.id == selected;
          return InkWell(
            onTap: () {
              ctrl.selectConversation(c.id);
              Get.find<ChatThreadController>().loadMessages(c.id);
            },
            child: Container(
              padding: EdgeInsets.symmetric(vertical: 10, horizontal: UIKit.spaceSm(context)),
              decoration: BoxDecoration(
                color: isSelected ? Theme.of(context).colorScheme.surface : Colors.transparent,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(children: [
                CircleAvatar(radius: 14),
                SizedBox(width: UIKit.spaceSm(context)),
                Expanded(child: Text('会话 ${c.id}', maxLines: 1, overflow: TextOverflow.ellipsis)),
                if (c.unreadCount > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(color: Colors.redAccent, borderRadius: BorderRadius.circular(10)),
                    child: Text('${c.unreadCount}', style: const TextStyle(color: Colors.white, fontSize: 12)),
                  ),
              ]),
            ),
          );
        },
      );
    });
  }
}