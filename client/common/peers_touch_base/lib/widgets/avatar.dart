import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:crypto/crypto.dart';
import 'package:get/get.dart';

import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/widgets/avatar_resolver.dart';

/// Avatar component. [actorId] (uid) is required. [avatarUrl] is optional and supported:
/// when provided it is used; when null, resolution uses registered [AvatarResolver] by [actorId].
class Avatar extends StatelessWidget {
  final String actorId;
  final String? avatarUrl;
  final String fallbackName;
  final double size;
  final double? fontSize;
  final double borderRadius;

  const Avatar({
    super.key,
    required this.actorId,
    this.avatarUrl,
    required this.fallbackName,
    this.size = 40,
    this.fontSize,
    this.borderRadius = 8,
  });

  /// Resolved URL: explicit [avatarUrl] if set, else from [AvatarResolver] by [actorId].
  String? get _resolvedUrl {
    if (avatarUrl != null && avatarUrl!.isNotEmpty) {
      return avatarUrl;
    }
    if (Get.isRegistered<AvatarResolver>()) {
      return Get.find<AvatarResolver>().getAvatarUrl(actorId);
    }
    return null;
  }

  String get _effectiveFallbackName {
    if (fallbackName.isNotEmpty) return fallbackName;
    if (Get.isRegistered<AvatarResolver>()) {
      return Get.find<AvatarResolver>().getFallbackName(actorId);
    }
    return actorId;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(borderRadius),
        color: Colors.grey[300],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: _buildAvatarContent(),
      ),
    );
  }

  Widget _buildAvatarContent() {
    final url = _resolvedUrl;
    LoggingService.debug('Avatar._buildAvatarContent: actorId="$actorId", resolvedUrl=${url != null && url.isNotEmpty}');
    
    if (url != null && url.isNotEmpty) {
      return _buildNetworkAvatar(url);
    }

    LoggingService.debug('Avatar._buildAvatarContent: Using placeholder for actorId="$actorId", fallbackName="$_effectiveFallbackName"');
    return _buildPlaceholderAvatar();
  }

  Widget _buildNetworkAvatar(String url) {
    
    String fullUrl = url;
    if (fullUrl.startsWith('/')) {
      final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
      fullUrl = '$baseUrl$fullUrl';
      LoggingService.debug('Avatar: Converted relative URL for actorId=$actorId, full="$fullUrl"');
    }
    
    LoggingService.debug('Avatar: Loading avatar for actorId=$actorId, url="$fullUrl"');

    if (fullUrl.startsWith('http://') || fullUrl.startsWith('https://')) {
      return Image.network(
        fullUrl,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) {
          LoggingService.warning('Avatar: Failed to load network image for actorId=$actorId, url="$fullUrl", error=$error');
          return _buildPlaceholderAvatar();
        },
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) {
            return child;
          }
          return Container(
            width: size,
            height: size,
            color: Colors.grey[300],
            child: Center(
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  value: loadingProgress.expectedTotalBytes != null
                      ? loadingProgress.cumulativeBytesLoaded / loadingProgress.expectedTotalBytes!
                      : null,
                ),
              ),
            ),
          );
        },
      );
    }

    LoggingService.warning('Avatar: Invalid URL format for actorId=$actorId, url="$fullUrl"');
    return _buildPlaceholderAvatar();
  }

  Widget _buildPlaceholderAvatar() {
    final letter = _getFirstLetter(_effectiveFallbackName);
    final color = _generateColorFromActorId(actorId);
    final textColor = _getContrastColor(color);

    return Container(
      width: size,
      height: size,
      color: color,
      child: Center(
        child: Text(
          letter,
          style: TextStyle(
            color: textColor,
            fontSize: fontSize ?? size * 0.4,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }

  String _getFirstLetter(String name) {
    if (name.isEmpty) {
      return '?';
    }
    return name.trim()[0].toUpperCase();
  }

  Color _generateColorFromActorId(String actorId) {
    if (actorId.isEmpty) {
      return Colors.grey;
    }

    final bytes = utf8.encode(actorId);
    final digest = sha256.convert(bytes);
    final hash = digest.bytes[0] | (digest.bytes[1] << 8) | (digest.bytes[2] << 16);

    final hue = (hash % 360).toDouble();
    final saturation = 0.6 + (hash % 20) / 100.0;
    final lightness = 0.5 + (hash % 15) / 100.0;

    return HSLColor.fromAHSL(1.0, hue, saturation, lightness).toColor();
  }

  Color _getContrastColor(Color backgroundColor) {
    final luminance = backgroundColor.computeLuminance();
    return luminance > 0.5 ? Colors.black87 : Colors.white;
  }
}
