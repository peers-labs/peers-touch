import 'package:flutter/material.dart';

/// Thread 消息数据
class ThreadMessage {
  const ThreadMessage({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.content,
    required this.sentAt,
    this.senderAvatarUrl,
  });

  final String id;
  final String senderId;
  final String senderName;
  final String content;
  final DateTime sentAt;
  final String? senderAvatarUrl;
}

/// Thread 数据
class ThreadData {
  const ThreadData({
    required this.parentMessage,
    this.replies = const [],
    this.replyCount = 0,
  });

  /// 父消息
  final ThreadMessage parentMessage;

  /// 回复列表
  final List<ThreadMessage> replies;

  /// 回复数量
  final int replyCount;
}

/// Slack 风格的 Thread 面板
class ThreadPanel extends StatelessWidget {
  const ThreadPanel({
    super.key,
    required this.thread,
    required this.onClose,
    required this.onSendReply,
    this.currentUserId,
    this.inputController,
    this.isSending = false,
    this.width = 360,
  });

  final ThreadData thread;
  final VoidCallback onClose;
  final void Function(String content) onSendReply;
  final String? currentUserId;
  final TextEditingController? inputController;
  final bool isSending;
  final double width;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      width: width,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          left: BorderSide(
            color: theme.dividerColor,
            width: 1,
          ),
        ),
      ),
      child: Column(
        children: [
          // Header
          _buildHeader(context),
          const Divider(height: 1),

          // Parent message
          _buildParentMessage(context),
          const Divider(height: 1),

          // Reply count
          if (thread.replyCount > 0)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Text(
                    '${thread.replyCount} ${thread.replyCount == 1 ? 'reply' : 'replies'}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.primary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const Spacer(),
                ],
              ),
            ),

          // Replies list
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              itemCount: thread.replies.length,
              itemBuilder: (context, index) {
                final reply = thread.replies[index];
                final isMe = reply.senderId == currentUserId;
                return _buildReplyItem(context, reply, isMe);
              },
            ),
          ),

          const Divider(height: 1),

          // Input bar
          _buildInputBar(context),
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          Text(
            'Thread',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          IconButton(
            icon: const Icon(Icons.close, size: 20),
            onPressed: onClose,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
          ),
        ],
      ),
    );
  }

  Widget _buildParentMessage(BuildContext context) {
    final theme = Theme.of(context);
    final msg = thread.parentMessage;

    return Container(
      padding: const EdgeInsets.all(12),
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Avatar
          CircleAvatar(
            radius: 18,
            backgroundColor: theme.colorScheme.primary,
            child: Text(
              msg.senderName.isNotEmpty ? msg.senderName[0].toUpperCase() : '?',
              style: const TextStyle(color: Colors.white, fontSize: 14),
            ),
          ),
          const SizedBox(width: 10),
          // Content
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      msg.senderName,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _formatTime(msg.sentAt),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.grey,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  msg.content,
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReplyItem(BuildContext context, ThreadMessage reply, bool isMe) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Avatar
          CircleAvatar(
            radius: 16,
            backgroundColor: isMe ? theme.colorScheme.primary : Colors.grey,
            child: Text(
              reply.senderName.isNotEmpty ? reply.senderName[0].toUpperCase() : '?',
              style: const TextStyle(color: Colors.white, fontSize: 12),
            ),
          ),
          const SizedBox(width: 8),
          // Content
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      reply.senderName,
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _formatTime(reply.sentAt),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: Colors.grey,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  reply.content,
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInputBar(BuildContext context) {
    final theme = Theme.of(context);
    final controller = inputController ?? TextEditingController();

    return Container(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              maxLines: 3,
              minLines: 1,
              enabled: !isSending,
              decoration: InputDecoration(
                hintText: 'Reply...',
                hintStyle: TextStyle(color: Colors.grey[400]),
                filled: true,
                fillColor: theme.colorScheme.surfaceContainerHighest,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
              ),
              onSubmitted: (text) {
                if (text.trim().isNotEmpty) {
                  onSendReply(text.trim());
                  controller.clear();
                }
              },
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: isSending
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Icon(Icons.send, color: theme.colorScheme.primary),
            onPressed: isSending
                ? null
                : () {
                    final text = controller.text.trim();
                    if (text.isNotEmpty) {
                      onSendReply(text);
                      controller.clear();
                    }
                  },
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';

    return '${dt.month}/${dt.day}';
  }
}
