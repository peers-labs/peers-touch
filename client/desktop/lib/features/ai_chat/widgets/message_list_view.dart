import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:intl/intl.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

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

String _formatMessageTime(DateTime dt) {
    final now = DateTime.now();
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return DateFormat.Hm().format(dt); // 今天：HH:mm
    } else if (now.difference(dt).inDays == 1) {
      return '昨天 ${DateFormat.Hm().format(dt)}';
    } else {
      return DateFormat('yyyy/MM/dd HH:mm').format(dt);
    }
  }

  @override
  Widget build(BuildContext context) {
    // 初次构建后也滚动到底部
    SchedulerBinding.instance.addPostFrameCallback((_) => _scrollToBottom(animated: false));
    return ListView.builder(
      controller: _scrollController,
      padding: EdgeInsets.all(UIKit.spaceMd(context)),
      itemCount: widget.messages.length,
      itemBuilder: (_, i) {
        final m = widget.messages[i];
        final isUser = m.role == ChatRole.CHAT_ROLE_USER;
        bool showTimestamp = false;
        if (i == 0) {
          showTimestamp = true;
        } else {
          final prev = widget.messages[i - 1];
          final currentTime = DateTime.fromMillisecondsSinceEpoch(m.createdAt.toInt());
          final prevTime = DateTime.fromMillisecondsSinceEpoch(prev.createdAt.toInt());
          if (currentTime.difference(prevTime).inMinutes > 5) {
            showTimestamp = true;
          }
        }

        return Column(
          children: [
            if (showTimestamp)
              Padding(
                padding: EdgeInsets.symmetric(vertical: UIKit.spaceMd(context)),
                child: Text(
                  _formatMessageTime(DateTime.fromMillisecondsSinceEpoch(m.createdAt.toInt())),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            Align(
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
            ),
          ],
        );
      },
    );
  }
}