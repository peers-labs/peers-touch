import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class ChatMessageItem extends StatelessWidget {
  const ChatMessageItem({
    super.key,
    required this.message,
    required this.isMe,
  });

  final ChatMessage message;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: UIKit.spaceXs(context)),
      child: Row(
        mainAxisAlignment: isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isMe) ...[
            _buildAvatar(context),
            SizedBox(width: UIKit.spaceSm(context)),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment:
                  isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
              children: [
                Container(
                  constraints: BoxConstraints(
                    maxWidth: MediaQuery.of(context).size.width * 0.6,
                  ),
                  padding: EdgeInsets.symmetric(
                    horizontal: UIKit.spaceMd(context),
                    vertical: UIKit.spaceSm(context),
                  ),
                  decoration: BoxDecoration(
                    color: isMe
                        ? Theme.of(context).colorScheme.primary
                        : UIKit.assistantBubbleBg(context),
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(UIKit.radiusMd(context)),
                      topRight: Radius.circular(UIKit.radiusMd(context)),
                      bottomLeft: isMe
                          ? Radius.circular(UIKit.radiusMd(context))
                          : Radius.zero,
                      bottomRight: isMe
                          ? Radius.zero
                          : Radius.circular(UIKit.radiusMd(context)),
                    ),
                  ),
                  child: SelectableText(
                    message.content,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: isMe
                              ? Theme.of(context).colorScheme.onPrimary
                              : Theme.of(context).colorScheme.onSurface,
                        ),
                  ),
                ),
                SizedBox(height: UIKit.spaceXs(context)),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _formatTime(message.sentAt.toDateTime()),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: UIKit.textSecondary(context),
                            fontSize: 10,
                          ),
                    ),
                    if (isMe) ...[
                      SizedBox(width: UIKit.spaceXs(context)),
                      _buildStatusIcon(context),
                    ],
                  ],
                ),
              ],
            ),
          ),
          if (isMe) ...[
            SizedBox(width: UIKit.spaceSm(context)),
            _buildAvatar(context),
          ],
        ],
      ),
    );
  }

  Widget _buildAvatar(BuildContext context) {
    return CircleAvatar(
      radius: 16,
      backgroundColor: isMe
          ? Theme.of(context).colorScheme.primary
          : Theme.of(context).colorScheme.primaryContainer,
      child: Icon(
        Icons.person,
        size: 18,
        color: isMe
            ? Theme.of(context).colorScheme.onPrimary
            : Theme.of(context).colorScheme.onPrimaryContainer,
      ),
    );
  }

  Widget _buildStatusIcon(BuildContext context) {
    IconData icon;
    Color color;

    switch (message.status) {
      case MessageStatus.MESSAGE_STATUS_SENDING:
        icon = Icons.access_time;
        color = UIKit.textSecondary(context);
      case MessageStatus.MESSAGE_STATUS_SENT:
        icon = Icons.check;
        color = UIKit.textSecondary(context);
      case MessageStatus.MESSAGE_STATUS_DELIVERED:
        icon = Icons.done_all;
        color = Theme.of(context).colorScheme.primary;
      case MessageStatus.MESSAGE_STATUS_FAILED:
        icon = Icons.error_outline;
        color = UIKit.errorColor(context);
      default:
        icon = Icons.check;
        color = UIKit.textSecondary(context);
    }

    return Icon(icon, size: 14, color: color);
  }

  String _formatTime(DateTime dt) {
    return DateFormat.Hm().format(dt);
  }
}
