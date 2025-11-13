import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';

class MessageListView extends StatefulWidget {
  final List<ChatMessage> messages;
  const MessageListView({super.key, required this.messages});

  @override
  State<MessageListView> createState() => _MessageListViewState();
}

class _MessageListViewState extends State<MessageListView> {
  final ScrollController _scrollController = ScrollController();

  void _scrollToBottom({bool animated = true}) {
    if (!_scrollController.hasClients) return;
    final max = _scrollController.position.maxScrollExtent;
    if (animated) {
      _scrollController.animateTo(
        max,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    } else {
      _scrollController.jumpTo(max);
    }
  }

  @override
  void didUpdateWidget(covariant MessageListView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.messages.length != oldWidget.messages.length) {
      SchedulerBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
    } else {
      SchedulerBinding.instance.addPostFrameCallback((_) => _scrollToBottom(animated: false));
    }
  }

  @override
  Widget build(BuildContext context) {
    SchedulerBinding.instance.addPostFrameCallback((_) => _scrollToBottom(animated: false));
    return ListView.builder(
      controller: _scrollController,
      padding: EdgeInsets.all(UIKit.spaceMd(context)),
      itemCount: widget.messages.length,
      itemBuilder: (_, i) {
        final m = widget.messages[i];
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