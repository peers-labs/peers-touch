import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';

class MessageListView extends StatelessWidget {
  final List<ChatMessage> messages;
  const MessageListView({super.key, required this.messages});

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: EdgeInsets.all(UIKit.spaceMd(context)),
      itemCount: messages.length,
      itemBuilder: (_, i) {
        final m = messages[i];
        final isUser = m.role == 'user';
        return Align(
          alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            margin: EdgeInsets.symmetric(vertical: UIKit.spaceSm(context)),
            padding: EdgeInsets.all(UIKit.spaceMd(context)),
            decoration: BoxDecoration(
              color: isUser
                  ? UIKit.userBubbleBg(context)
                  : UIKit.assistantBubbleBg(context),
              borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
            ),
            child: Text(m.content),
          ),
        );
      },
    );
  }
}