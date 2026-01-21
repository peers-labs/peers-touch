import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/widgets/avatar.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

class SessionListItem extends StatelessWidget {
  const SessionListItem({
    super.key,
    required this.session,
    required this.isSelected,
    required this.onTap,
    this.onDelete,
  });

  final ChatSession session;
  final bool isSelected;
  final VoidCallback onTap;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        color: isSelected
            ? Theme.of(context).colorScheme.primaryContainer
            : Colors.transparent,
        padding: EdgeInsets.symmetric(
          horizontal: UIKit.spaceMd(context),
          vertical: UIKit.spaceSm(context),
        ),
        child: Row(
          children: [
            _buildAvatar(context),
            SizedBox(width: UIKit.spaceSm(context)),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          session.topic,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w500,
                              ),
                        ),
                      ),
                      if (session.hasLastMessageAt())
                        Text(
                          _formatTime(context, session.lastMessageAt.toDateTime()),
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: UIKit.textSecondary(context),
                              ),
                        ),
                    ],
                  ),
                  SizedBox(height: UIKit.spaceXs(context)),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          session.lastMessageSnippet,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                color: UIKit.textSecondary(context),
                              ),
                        ),
                      ),
                      if (session.unreadCount.toInt() > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.primary,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            session.unreadCount.toInt() > 99
                                ? '99+'
                                : session.unreadCount.toString(),
                            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                  color: Theme.of(context).colorScheme.onPrimary,
                                ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAvatar(BuildContext context) {
    final isGroup = session.type == SessionType.SESSION_TYPE_GROUP;
    if (isGroup) {
      return Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primaryContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(
          Icons.group,
          size: 20,
          color: Theme.of(context).colorScheme.onPrimaryContainer,
        ),
      );
    }

    final actorId = session.participantIds.length > 1 ? session.participantIds[1] : '';
    return Avatar(
      actorId: actorId,
      fallbackName: session.topic,
      size: 40,
    );
  }

  String _formatTime(BuildContext context, DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final date = DateTime(dt.year, dt.month, dt.day);

    if (date == today) {
      return DateFormat.Hm().format(dt);
    } else if (today.difference(date).inDays == 1) {
      return 'Yesterday';
    } else if (today.difference(date).inDays < 7) {
      return DateFormat.E().format(dt);
    } else {
      return DateFormat('MM/dd').format(dt);
    }
  }
}
