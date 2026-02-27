import 'package:flutter/material.dart' hide Badge;
import 'package:peers_touch_ui/primitives/avatar/avatar.dart';
import 'package:peers_touch_ui/primitives/badge.dart';
import 'package:peers_touch_ui/theme/theme.dart';

class ConversationItem extends StatefulWidget {
  final String name;
  final String? lastMessage;
  final String? time;
  final String? avatarUrl;
  final int? unreadCount;
  final bool isOnline;
  final bool isPinned;
  final bool isMuted;
  final bool isSelected;
  final VoidCallback? onTap;
  final VoidCallback? onSecondaryTap;

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
    this.isSelected = false,
    this.onTap,
    this.onSecondaryTap,
  });

  @override
  State<ConversationItem> createState() => _ConversationItemState();
}

class _ConversationItemState extends State<ConversationItem> {
  bool _isHovered = false;

  @override
  Widget build(BuildContext context) {
    final bgColor = widget.isSelected
        ? AppColors.primary.withValues(alpha: 0.08)
        : _isHovered
            ? AppColors.backgroundHover
            : Colors.transparent;

    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) {
        if (mounted) {
          setState(() => _isHovered = true);
        }
      },
      onExit: (_) {
        if (mounted) {
          setState(() => _isHovered = false);
        }
      },
      child: GestureDetector(
        onTap: widget.onTap,
        onSecondaryTap: widget.onSecondaryTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeInOut,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: AppRadius.mdBorder,
          ),
          child: Row(
            children: [
              Avatar(
                imageUrl: widget.avatarUrl,
                name: widget.name,
                size: AvatarSize.lg,
                showOnlineStatus: true,
                isOnline: widget.isOnline,
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
                            widget.name,
                            style: TextStyle(
                              fontFamily: AppTypography.fontFamily,
                              fontSize: AppTypography.fontSizeMd,
                              fontWeight: widget.unreadCount != null && widget.unreadCount! > 0
                                  ? AppTypography.fontWeightSemibold
                                  : AppTypography.fontWeightMedium,
                              color: AppColors.textPrimary,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (widget.isMuted) ...[
                          Icon(
                            Icons.notifications_off_outlined,
                            size: 14,
                            color: AppColors.textTertiary,
                          ),
                          const SizedBox(width: AppSpacing.xxs),
                        ],
                        if (widget.time != null)
                          Text(
                            widget.time!,
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
                            widget.lastMessage ?? '',
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
                        if (widget.unreadCount != null && widget.unreadCount! > 0) ...[
                          const SizedBox(width: AppSpacing.xs),
                          Badge(
                            variant: BadgeVariant.count,
                            count: widget.unreadCount,
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
      ),
    );
  }
}
