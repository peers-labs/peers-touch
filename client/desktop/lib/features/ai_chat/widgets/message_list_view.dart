import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:peers_touch_base/ai_proxy/token/token_counter.dart';
import 'package:peers_touch_base/i18n/generated/app_localizations.dart';
import 'package:peers_touch_base/model/domain/ai_box/chat.pb.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';

/// Message list view for AI chat.
/// StatelessWidget per project convention (ADR-002).
class MessageListView extends StatelessWidget {
  const MessageListView({super.key, required this.messages});
  final List<ChatMessage> messages;

  String _formatMessageTime(BuildContext context, DateTime dt) {
    final now = DateTime.now();
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return DateFormat.Hm().format(dt); // 今天：HH:mm
    } else if (now.difference(dt).inDays == 1) {
      return '${AppLocalizations.of(context)!.yesterday} ${DateFormat.Hm().format(dt)}';
    } else {
      return DateFormat('yyyy/MM/dd HH:mm').format(dt);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<AIChatController>();
    
    // 初次构建后滚动到底部
    SchedulerBinding.instance.addPostFrameCallback((_) {
      controller.scrollToBottom(animated: false);
    });
    
    return Obx(() {
      final showTokens = controller.showTokens.value;
      return ListView.builder(
        controller: controller.messageScrollController,
        padding: EdgeInsets.all(UIKit.spaceMd(context)),
        itemCount: messages.length,
        itemBuilder: (_, i) {
          final m = messages[i];
          final isUser = m.role == ChatRole.CHAT_ROLE_USER;
          bool showTimestamp = false;
          if (i == 0) {
            showTimestamp = true;
          } else {
            final prev = messages[i - 1];
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
                    _formatMessageTime(context, DateTime.fromMillisecondsSinceEpoch(m.createdAt.toInt())),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              Align(
                alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                child: Column(
                  crossAxisAlignment: isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                  children: [
                    Container(
                      margin: EdgeInsets.symmetric(vertical: UIKit.spaceSm(context)),
                      padding: EdgeInsets.all(UIKit.spaceMd(context)),
                      decoration: BoxDecoration(
                        color: UIKit.assistantBubbleBg(context),
                        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
                      ),
                      child: SelectableText(m.content),
                    ),
                    if (showTokens)
                      Padding(
                        padding: const EdgeInsets.only(top: 2, left: 6, right: 6),
                        child: _TokenBadge(count: TokenCounter.countTextTokens(m.content)),
                      ),
                  ],
                ),
              ),
            ],
          );
        },
      );
    });
  }
}

class _TokenBadge extends StatelessWidget {
  const _TokenBadge({required this.count});
  final int count;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        '$count',
        style: Theme.of(context).textTheme.bodySmall,
      ),
    );
  }
}
