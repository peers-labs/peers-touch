import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

/// A message bubble widget for group chat messages
/// Follows the same design pattern as ChatMessageItem for friend chat
class GroupMessageBubble extends StatelessWidget {
  final GroupMessageInfo message;
  final bool isMe;
  final String senderName;
  final String? senderAvatarUrl;
  final String? senderActorId;
  final VoidCallback? onReply;
  final VoidCallback? onDelete;

  const GroupMessageBubble({
    super.key,
    required this.message,
    required this.isMe,
    required this.senderName,
    this.senderAvatarUrl,
    this.senderActorId,
    this.onReply,
    this.onDelete,
  });
  
  bool get canRecall {
    if (!isMe) return false;
    final sentAt = DateTime.fromMillisecondsSinceEpoch(message.sentAt * 1000);
    final diff = DateTime.now().difference(sentAt);
    return diff.inMinutes <= 2;
  }

  @override
  Widget build(BuildContext context) {
    if (message.deleted) {
      return _buildDeletedMessage(context);
    }

    return MessageContextMenu(
      onReply: onReply,
      onCopy: message.type == 1 ? () => _copyToClipboard(message.content) : null,
      onDelete: onDelete,
      canRecall: canRecall,
      canDelete: isMe,
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
        child: Row(
          mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isMe) ...[
              _buildAvatar(context),
              SizedBox(width: UIKit.spaceSm(context)),
            ],
            Flexible(
              child: Column(
                crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                children: [
                  if (!isMe)
                    Padding(
                      padding: EdgeInsets.only(
                        left: UIKit.spaceXs(context),
                        bottom: UIKit.spaceXs(context) / 2,
                      ),
                      child: Text(
                        senderName,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: UIKit.textSecondary(context),
                              fontWeight: FontWeight.w500,
                            ),
                      ),
                    ),
                  _buildMessageContent(context),
                  SizedBox(height: UIKit.spaceXs(context)),
                  _buildTimestamp(context),
                ],
              ),
            ),
            if (isMe) ...[
              SizedBox(width: UIKit.spaceSm(context)),
              _buildAvatar(context),
            ],
          ],
        ),
      ),
    );
  }
  
  void _copyToClipboard(String text) {
    Clipboard.setData(ClipboardData(text: text));
  }

  Widget _buildAvatar(BuildContext context) {
    return Avatar(
      actorId: senderActorId ?? message.senderDid,
      avatarUrl: senderAvatarUrl,
      fallbackName: senderName,
      size: 40,
    );
  }

  Widget _buildMessageContent(BuildContext context) {
    switch (message.type) {
      case 10: // SYSTEM
        return _buildSystemMessage(context);
      default:
        return _buildTextMessage(context);
    }
  }

  Widget _buildTextMessage(BuildContext context) {
    return Container(
      constraints: BoxConstraints(
        minWidth: 40,
        maxWidth: MediaQuery.of(context).size.width * 0.6,
      ),
      padding: EdgeInsets.symmetric(
        horizontal: UIKit.spaceMd(context),
        vertical: UIKit.spaceSm(context),
      ),
      decoration: BoxDecoration(
        color: isMe
            ? Theme.of(context).colorScheme.primaryContainer
            : Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
      ),
      child: SelectableText(
        message.content,
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: isMe
                  ? Theme.of(context).colorScheme.onPrimaryContainer
                  : Theme.of(context).colorScheme.onSurface,
            ),
      ),
    );
  }

  Widget _buildSystemMessage(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: UIKit.spaceMd(context),
        vertical: UIKit.spaceXs(context),
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(UIKit.radiusSm(context)),
      ),
      child: Text(
        message.content,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: UIKit.textSecondary(context),
              fontStyle: FontStyle.italic,
            ),
      ),
    );
  }

  Widget _buildDeletedMessage(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
      child: Row(
        mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          Container(
            padding: EdgeInsets.symmetric(
              horizontal: UIKit.spaceMd(context),
              vertical: UIKit.spaceSm(context),
            ),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerLow,
              borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
              border: Border.all(
                color: UIKit.dividerColor(context),
              ),
            ),
            child: Text(
              '消息已删除',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: UIKit.textSecondary(context),
                    fontStyle: FontStyle.italic,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTimestamp(BuildContext context) {
    if (message.sentAt == 0) return const SizedBox.shrink();

    final date = DateTime.fromMillisecondsSinceEpoch(message.sentAt * 1000);

    return Padding(
      padding: EdgeInsets.symmetric(horizontal: UIKit.spaceXs(context)),
      child: Text(
        _formatTime(date),
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: UIKit.textSecondary(context),
              fontSize: 10,
            ),
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final now = DateTime.now();
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return DateFormat.Hm().format(dt);
    }
    return DateFormat('M/d HH:mm').format(dt);
  }
}
