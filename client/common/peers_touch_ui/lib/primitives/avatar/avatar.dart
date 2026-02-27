import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:crypto/crypto.dart';
import 'package:get/get.dart';

import 'package:peers_touch_ui/theme/theme.dart';
import 'package:peers_touch_ui/components/media/image_viewer.dart';

enum AvatarSize { xxs, xs, sm, md, lg, xl, xxl }

abstract class AvatarResolver {
  String? getAvatarUrl(String actorId);
  String getFallbackName(String actorId) => actorId;
  Future<String?> fetchAvatarUrl(String actorId) async => null;
}

class Avatar extends StatelessWidget {
  final String? actorId;
  final String? avatarUrl;
  final String? imageUrl;
  final String? fallbackName;
  final String? name;
  final dynamic size;
  final double? fontSize;
  final double? borderRadius;
  final Color? backgroundColor;
  final Color? textColor;
  final VoidCallback? onTap;
  final bool showOnlineStatus;
  final bool isOnline;
  final String? baseUrl;

  const Avatar({
    super.key,
    this.actorId,
    this.avatarUrl,
    this.imageUrl,
    this.fallbackName,
    this.name,
    this.size = AvatarSize.md,
    this.fontSize,
    this.borderRadius,
    this.backgroundColor,
    this.textColor,
    this.onTap,
    this.showOnlineStatus = false,
    this.isOnline = false,
    this.baseUrl,
  });

  double get _size {
    if (size is num) {
      return size.toDouble();
    }
    switch (size as AvatarSize) {
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
    if (fontSize != null) {
      return fontSize!;
    }
    if (size is num) {
      return size.toDouble() * 0.4;
    }
    switch (size as AvatarSize) {
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
    if (size is num) {
      return size.toDouble() * 0.2;
    }
    switch (size as AvatarSize) {
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

  double get _borderRadius {
    if (borderRadius != null) {
      return borderRadius!;
    }
    return 8.0;
  }

  String? get _resolvedUrl {
    if (avatarUrl != null && avatarUrl!.isNotEmpty) {
      return avatarUrl;
    }
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      return imageUrl;
    }
    if (actorId != null && Get.isRegistered<AvatarResolver>()) {
      return Get.find<AvatarResolver>().getAvatarUrl(actorId!);
    }
    return null;
  }

  String get _effectiveFallbackName {
    if (fallbackName != null && fallbackName!.isNotEmpty) {
      return fallbackName!;
    }
    if (name != null && name!.isNotEmpty) {
      return name!;
    }
    if (actorId != null && Get.isRegistered<AvatarResolver>()) {
      return Get.find<AvatarResolver>().getFallbackName(actorId!);
    }
    return actorId ?? '?';
  }

  String get _initials {
    final name = _effectiveFallbackName;
    if (name.isEmpty || name == '?') return '?';
    final parts = name.trim().split(' ');
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return name[0].toUpperCase();
  }

  Color get _generatedBackgroundColor {
    if (backgroundColor != null) return backgroundColor!;
    
    final id = actorId ?? fallbackName ?? '?';
    if (id.isEmpty || id == '?') {
      return AppColors.backgroundTertiary;
    }

    final bytes = utf8.encode(id);
    final digest = sha256.convert(bytes);
    final hash = digest.bytes[0] | (digest.bytes[1] << 8) | (digest.bytes[2] << 16);

    final hue = (hash % 360).toDouble();
    final saturation = 0.6 + (hash % 20) / 100.0;
    final lightness = 0.5 + (hash % 15) / 100.0;

    return HSLColor.fromAHSL(1.0, hue, saturation, lightness).toColor();
  }

  Color get _textColorComputed {
    if (textColor != null) return textColor!;
    final bgColor = _generatedBackgroundColor;
    final luminance = bgColor.computeLuminance();
    return luminance > 0.5 ? AppColors.textPrimary : AppColors.white;
  }

  @override
  Widget build(BuildContext context) {
    Widget avatar = _buildAvatarContent();

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

  Widget _buildAvatarContent() {
    final url = _resolvedUrl;
    
    if (url != null && url.isNotEmpty) {
      return _buildNetworkAvatar(url);
    }

    return _buildPlaceholderAvatar();
  }

  Widget _buildNetworkAvatar(String url) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(_borderRadius),
      child: PeersImage(
        src: url,
        width: _size,
        height: _size,
        fit: BoxFit.cover,
        baseUrl: baseUrl,
        error: _buildPlaceholderAvatar(),
        placeholder: Container(
          width: _size,
          height: _size,
          decoration: BoxDecoration(
            color: AppColors.backgroundTertiary,
            borderRadius: BorderRadius.circular(_borderRadius),
          ),
          child: const Center(
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
    );
  }

  Widget _buildPlaceholderAvatar() {
    return Container(
      width: _size,
      height: _size,
      decoration: BoxDecoration(
        color: _generatedBackgroundColor,
        borderRadius: BorderRadius.circular(_borderRadius),
      ),
      child: Center(
        child: Text(
          _initials,
          style: TextStyle(
            fontFamily: AppTypography.fontFamily,
            fontSize: _fontSize,
            fontWeight: AppTypography.fontWeightSemibold,
            color: _textColorComputed,
          ),
        ),
      ),
    );
  }
}
