import 'package:flutter/material.dart';
import 'package:peers_touch_ui/tokens/tokens.dart';

enum AvatarSize { xxs, xs, sm, md, lg, xl, xxl }

class Avatar extends StatelessWidget {
  final String? imageUrl;
  final String? name;
  final AvatarSize size;
  final Color? backgroundColor;
  final Color? textColor;
  final VoidCallback? onTap;
  final bool showOnlineStatus;
  final bool isOnline;

  const Avatar({
    super.key,
    this.imageUrl,
    this.name,
    this.size = AvatarSize.md,
    this.backgroundColor,
    this.textColor,
    this.onTap,
    this.showOnlineStatus = false,
    this.isOnline = false,
  });

  double get _size {
    switch (size) {
      case AvatarSize.xxs:
        return 20;
      case AvatarSize.xs:
        return 24;
      case AvatarSize.sm:
        return 32;
      case AvatarSize.md:
        return 40;
      case AvatarSize.lg:
        return 48;
      case AvatarSize.xl:
        return 64;
      case AvatarSize.xxl:
        return 80;
    }
  }

  double get _fontSize {
    switch (size) {
      case AvatarSize.xxs:
        return AppTypography.fontSizeXs;
      case AvatarSize.xs:
        return AppTypography.fontSizeXs;
      case AvatarSize.sm:
        return AppTypography.fontSizeSm;
      case AvatarSize.md:
        return AppTypography.fontSizeMd;
      case AvatarSize.lg:
        return AppTypography.fontSizeLg;
      case AvatarSize.xl:
        return AppTypography.fontSizeXl;
      case AvatarSize.xxl:
        return AppTypography.fontSizeXxl;
    }
  }

  double get _onlineIndicatorSize {
    switch (size) {
      case AvatarSize.xxs:
      case AvatarSize.xs:
        return 6;
      case AvatarSize.sm:
        return 8;
      case AvatarSize.md:
        return 10;
      case AvatarSize.lg:
        return 12;
      case AvatarSize.xl:
        return 14;
      case AvatarSize.xxl:
        return 16;
    }
  }

  String get _initials {
    if (name == null || name!.isEmpty) return '?';
    final parts = name!.trim().split(' ');
    if (parts.length >= 2) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name![0].toUpperCase();
  }

  Color get _backgroundColor {
    if (backgroundColor != null) return backgroundColor!;
    final hash = name?.hashCode ?? 0;
    final colors = [
      AppColors.primary,
      AppColors.info,
      AppColors.success,
      AppColors.warning,
      AppColors.error,
    ];
    return colors[hash.abs() % colors.length];
  }

  @override
  Widget build(BuildContext context) {
    Widget avatar;

    if (imageUrl != null && imageUrl!.isNotEmpty) {
      avatar = ClipRRect(
        borderRadius: AppRadius.avatarRadius,
        child: Image.network(
          imageUrl!,
          width: _size,
          height: _size,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => _buildInitialsAvatar(),
        ),
      );
    } else {
      avatar = _buildInitialsAvatar();
    }

    if (showOnlineStatus) {
      avatar = Stack(
        clipBehavior: Clip.none,
        children: [
          avatar,
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: _onlineIndicatorSize,
              height: _onlineIndicatorSize,
              decoration: BoxDecoration(
                color: isOnline ? AppColors.success : AppColors.textTertiary,
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.background,
                  width: 2,
                ),
              ),
            ),
          ),
        ],
      );
    }

    if (onTap != null) {
      avatar = GestureDetector(
        onTap: onTap,
        child: avatar,
      );
    }

    return avatar;
  }

  Widget _buildInitialsAvatar() {
    return Container(
      width: _size,
      height: _size,
      decoration: BoxDecoration(
        color: _backgroundColor,
        borderRadius: AppRadius.avatarRadius,
      ),
      child: Center(
        child: Text(
          _initials,
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: _fontSize,
            fontWeight: AppTypography.fontWeightSemibold,
            color: textColor ?? AppColors.white,
          ),
        ),
      ),
    );
  }
}
