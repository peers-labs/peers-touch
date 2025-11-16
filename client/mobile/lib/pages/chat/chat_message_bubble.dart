import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/pages/chat/models/friend_model.dart';
import 'package:peers_touch_mobile/pages/chat/models/message_model.dart';

class MessageBubble extends StatelessWidget {
  final MessageModel message;
  final FriendModel friend;
  final VoidCallback onLongPress;

  const MessageBubble({
    super.key,
    required this.message,
    required this.friend,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    if (message.messageType == 'system') {
      return _buildSystemMessage(context);
    }
    
    return GestureDetector(
      onLongPress: onLongPress,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisAlignment: message.isMine ? MainAxisAlignment.end : MainAxisAlignment.start,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (!message.isMine) _buildAvatar(),
            _buildMessageContent(context),
          ],
        ),
      ),
    );
  }

  Widget _buildAvatar() {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: CircleAvatar(
        radius: 18,
        backgroundImage: NetworkImage(friend.avatarUrl),
      ),
    );
  }

  Widget _buildMessageContent(BuildContext context) {
    return Column(
      crossAxisAlignment: message.isMine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Container(
          constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.7,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: message.isMine ? const Color(0xFFD5F5C4) : Colors.white,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(message.isMine ? 18 : 4),
              topRight: Radius.circular(message.isMine ? 4 : 18),
              bottomLeft: const Radius.circular(18),
              bottomRight: const Radius.circular(18),
            ),
            border: message.isMine 
                ? null 
                : Border.all(color: const Color(0xFFE5E5E5)),
          ),
          child: Text(
            message.content,
            style: const TextStyle(
              fontSize: 14,
              color: Color(0xFF333333),
              height: 1.5,
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4, left: 4, right: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                message.getFormattedTime(),
                style: const TextStyle(fontSize: 12, color: Color(0xFF999999)),
              ),
              if (message.isMine) ...[  
                const SizedBox(width: 4),
                _buildStatusIcon(),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStatusIcon() {
    switch (message.status) {
      case 'sending':
        return const Text(
          '发送中...',
          style: TextStyle(fontSize: 12, color: Color(0xFF999999)),
        );
      case 'sent':
        return const Icon(
          Icons.check,
          size: 12,
          color: Color(0xFF999999),
        );
      case 'read':
        return const Icon(
          Icons.done_all,
          size: 12,
          color: Colors.blue,
        );
      case 'failed':
        return const Icon(
          Icons.error_outline,
          size: 12,
          color: Colors.red,
        );
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildSystemMessage(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.grey[200],
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.grey[300]!),
          ),
          child: Text(
            message.content,
            style: const TextStyle(fontSize: 12, color: Color(0xFF999999)),
          ),
        ),
      ),
    );
  }
}