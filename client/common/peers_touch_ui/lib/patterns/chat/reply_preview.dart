import 'package:flutter/material.dart';

/// 回复消息预览数据
class ReplyMessage {
  const ReplyMessage({
    required this.id,
    required this.senderName,
    required this.content,
    this.senderAvatarUrl,
    this.messageType,
  });

  final String id;
  final String senderName;
  final String content;
  final String? senderAvatarUrl;
  final String? messageType; // text, image, file, etc.

  /// 获取显示内容
  String get displayContent {
    switch (messageType) {
      case 'image':
        return '[图片]';
      case 'file':
        return '[文件]';
      case 'audio':
        return '[语音]';
      case 'video':
        return '[视频]';
      case 'sticker':
        return '[表情]';
      case 'location':
        return '[位置]';
      default:
        return content.length > 50 ? '${content.substring(0, 50)}...' : content;
    }
  }
}

/// 回复预览条
///
/// 显示在输入框上方，表示正在回复某条消息。
class ReplyPreview extends StatelessWidget {
  const ReplyPreview({
    super.key,
    required this.replyMessage,
    required this.onClose,
  });

  final ReplyMessage replyMessage;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        border: Border(
          left: BorderSide(
            color: theme.colorScheme.primary,
            width: 3,
          ),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.reply,
            size: 16,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '回复 ${replyMessage.senderName}',
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  replyMessage.displayContent,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 18),
            onPressed: onClose,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(
              minWidth: 32,
              minHeight: 32,
            ),
          ),
        ],
      ),
    );
  }
}

/// 消息中的引用块
///
/// 显示在消息内容上方，表示该消息是回复另一条消息。
class ReplyQuoteBlock extends StatelessWidget {
  const ReplyQuoteBlock({
    super.key,
    required this.replyMessage,
    this.onTap,
    this.isIncoming = true,
  });

  final ReplyMessage replyMessage;
  final VoidCallback? onTap;
  final bool isIncoming;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bgColor = isIncoming
        ? theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5)
        : theme.colorScheme.primaryContainer.withValues(alpha: 0.5);

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(6),
          border: Border(
            left: BorderSide(
              color: theme.colorScheme.primary.withValues(alpha: 0.7),
              width: 2,
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              replyMessage.senderName,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.primary,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              replyMessage.displayContent,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
