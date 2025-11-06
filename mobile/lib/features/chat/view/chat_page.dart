import 'package:flutter/widgets.dart';
import 'package:peers_touch_mobile/pages/chat/chat_page.dart' as legacy_chat;

class ChatPage extends StatelessWidget {
  const ChatPage({super.key});

  static List<dynamic> get actionOptions => legacy_chat.ChatPage.actionOptions;

  @override
  Widget build(BuildContext context) {
    return const legacy_chat.ChatPage();
  }
}