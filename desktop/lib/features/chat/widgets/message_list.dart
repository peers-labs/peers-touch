import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_thread_controller.dart';

class MessageList extends StatelessWidget {
  const MessageList({super.key});

  @override
  Widget build(BuildContext context) {
    final ctrl = Get.find<ChatThreadController>();
    return Obx(() {
      final items = ctrl.messages;
      return ListView.builder(
        itemCount: items.length,
        itemBuilder: (ctx, i) {
          final m = items[i];
          final isMine = m.authorId == 'me';
          return Align(
            alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
              decoration: BoxDecoration(
                color: isMine ? Theme.of(context).colorScheme.primary.withOpacity(0.15) : Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(m.contentText),
            ),
          );
        },
      );
    });
  }
}