import 'package:flutter/material.dart';
import 'package:peers_touch_ui/foundation/avatar.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

enum MessageBubbleType { sent, received }

class MessageBubble extends StatelessWidget {
  final String message;
  final MessageBubbleType type;
  final String? time;
  final String? senderName;
  final String? senderAvatar;
  final bool showAvatar;
  final bool showName;
  final bool showTime;

  const MessageBubble({
    super.key,
    required this.message,
    this.type = MessageBubbleType.received,
    this.time,
    this.senderName,
    this.senderAvatar,
    this.showAvatar = true,
    this.showName = false,
    this.showTime = true,
  });

  Color get _backgroundColor {
    switch (type) {
      case MessageBubbleType.sent:
        return AppColors.chatBubbleSelf;
      case MessageBubbleType.received:
        return AppColors.chatBubbleOther;
    }
  }

  Color get _textColor {
    switch (type) {
      case MessageBubbleType.sent:
        return AppColors.white;
      case MessageBubbleType.received:
        return AppColors.textPrimary;
    }
  }

  Color get _timeColor {
    switch (type) {
      case MessageBubbleType.sent:
        return AppColors.white.withValues(alpha: 0.7);
      case MessageBubbleType.received:
        return AppColors.textTertiary;
    }
  }

  BorderRadius get _borderRadius {
    switch (type) {
      case MessageBubbleType.sent:
        return const BorderRadius.only(
          topLeft: Radius.circular(AppRadius.lg),
          topRight: Radius.circular(AppRadius.xs),
          bottomLeft: Radius.circular(AppRadius.lg),
          bottomRight: Radius.circular(AppRadius.lg),
        );
      case MessageBubbleType.received:
        return const BorderRadius.only(
          topLeft: Radius.circular(AppRadius.xs),
          topRight: Radius.circular(AppRadius.lg),
          bottomLeft: Radius.circular(AppRadius.lg),
          bottomRight: Radius.circular(AppRadius.lg),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final messageWidget = Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: _backgroundColor,
        borderRadius: _borderRadius,
      ),
      child: Column(
        crossAxisAlignment: type == MessageBubbleType.sent
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showName && senderName != null && type == MessageBubbleType.received) ...[
            Text(
              senderName!,
              style: TextStyle(
                fontFamily: AppTypography.fontFamily,
                fontSize: AppTypography.fontSizeXs,
                fontWeight: AppTypography.fontWeightMedium,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 2),
          ],
          Text(
            message,
            style: TextStyle(
              fontFamily: AppTypography.fontFamily,
              fontSize: AppTypography.fontSizeMd,
              fontWeight: AppTypography.fontWeightNormal,
              color: _textColor,
              height: 1.4,
            ),
          ),
          if (showTime && time != null) ...[
            const SizedBox(height: 4),
            Text(
              time!,
              style: TextStyle(
                fontFamily: AppTypography.fontFamily,
                fontSize: AppTypography.fontSizeXs,
                fontWeight: AppTypography.fontWeightNormal,
                color: _timeColor,
              ),
            ),
          ],
        ],
      ),
    );

    if (type == MessageBubbleType.sent) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.xxs,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.end,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Flexible(child: messageWidget),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.xxs,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showAvatar) ...[
            Avatar(
              imageUrl: senderAvatar,
              name: senderName,
              size: AvatarSize.sm,
            ),
            const SizedBox(width: AppSpacing.sm),
          ],
          Flexible(child: messageWidget),
        ],
      ),
    );
  }
}
