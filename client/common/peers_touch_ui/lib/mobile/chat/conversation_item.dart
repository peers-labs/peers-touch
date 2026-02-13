import 'package:flutter/material.dart' hide Badge;
import 'package:peers_touch_ui/foundation/avatar.dart';
import 'package:peers_touch_ui/foundation/badge.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

class ConversationItem extends StatelessWidget {
  final String name;
  final String? lastMessage;
  final String? time;
  final String? avatarUrl;
  final int? unreadCount;
  final bool isOnline;
  final bool isPinned;
  final bool isMuted;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  const ConversationItem({
    super.key,
    required this.name,
    this.lastMessage,
    this.time,
    this.avatarUrl,
    this.unreadCount,
    this.isOnline = false,
    this.isPinned = false,
    this.isMuted = false,
    this.onTap,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        color: isPinned ? AppColors.backgroundSecondary : Colors.transparent,
        child: Row(
          children: [
            Avatar(
              imageUrl: avatarUrl,
              name: name,
              size: AvatarSize.lg,
              showOnlineStatus: true,
              isOnline: isOnline,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          name,
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: AppTypography.fontSizeMd,
                            fontWeight: unreadCount != null && unreadCount! > 0
                                ? AppTypography.fontWeightSemibold
                                : AppTypography.fontWeightMedium,
                            color: AppColors.textPrimary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (isMuted) ...[
                        Icon(
                          Icons.notifications_off_outlined,
                          size: 14,
                          color: AppColors.textTertiary,
                        ),
                        const SizedBox(width: AppSpacing.xxs),
                      ],
                      if (time != null)
                        Text(
                          time!,
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: AppTypography.fontSizeXs,
                            fontWeight: AppTypography.fontWeightNormal,
                            color: AppColors.textTertiary,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          lastMessage ?? '',
                          style: TextStyle(
                            fontFamily: AppTypography.fontFamily,
                            fontSize: AppTypography.fontSizeSm,
                            fontWeight: AppTypography.fontWeightNormal,
                            color: AppColors.textSecondary,
                          ),
                          overflow: TextOverflow.ellipsis,
                          maxLines: 1,
                        ),
                      ),
                      if (unreadCount != null && unreadCount! > 0) ...[
                        const SizedBox(width: AppSpacing.xs),
                        Badge(
                          variant: BadgeVariant.count,
                          count: unreadCount,
                          size: BadgeSize.small,
                        ),
                      ],
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
}
