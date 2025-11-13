import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_thread_controller.dart';

class ChatInputBar extends StatefulWidget {
  const ChatInputBar({super.key});

  @override
  State<ChatInputBar> createState() => _ChatInputBarState();
}

class _ChatInputBarState extends State<ChatInputBar> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final thread = Get.find<ChatThreadController>();
    return Row(children: [
      Expanded(
        child: TextField(
          controller: _controller,
          minLines: 1,
          maxLines: 4,
          decoration: const InputDecoration(border: OutlineInputBorder(), hintText: '输入消息...'),
        ),
      ),
      const SizedBox(width: 8),
      IconButton(
        icon: const Icon(Icons.send),
        onPressed: () async {
          final text = _controller.text.trim();
          if (text.isEmpty) return;
          await thread.sendText(text);
          _controller.clear();
        },
      ),
    ]);
  }
}