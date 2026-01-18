import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';

import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/storage/remote_image_cache_service.dart';

class Avatar extends StatelessWidget {
  const Avatar({
    super.key,
    required this.actorId,
    this.avatarUrl,
    required this.fallbackName,
    this.size = 40,
    this.fontSize,
    this.borderRadius = 8,
    this.cacheMaxAge = const Duration(days: 30),
  });

  final String actorId;
  final String? avatarUrl;
  final String fallbackName;
  final double size;
  final double? fontSize;
  final double borderRadius;
  final Duration cacheMaxAge;

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
        child: _buildAvatarContent(context),
      ),
    );
  }

  Widget _buildAvatarContent(BuildContext context) {
    LoggingService.debug('Avatar._buildAvatarContent: actorId="$actorId", avatarUrl="$avatarUrl"');
    
    if (avatarUrl != null && avatarUrl!.isNotEmpty) {
      return _buildCachedAvatar(context);
    }

    LoggingService.debug('Avatar._buildAvatarContent: Using placeholder for actorId="$actorId", fallbackName="$fallbackName"');
    return _buildPlaceholderAvatar();
  }

  Widget _buildCachedAvatar(BuildContext context) {
    final src = avatarUrl!;
    final future = RemoteImageCacheService().getOrFetch(src, maxAge: cacheMaxAge);
    return FutureBuilder<File?>(
      future: future,
      builder: (context, snapshot) {
        final file = snapshot.data;
        if (file != null) {
          return Image.file(
            file,
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) {
              LoggingService.warning('Avatar: Failed to decode cached image for actorId=$actorId, src="$src", error=$error');
              return _buildPlaceholderAvatar();
            },
          );
        }

        if (snapshot.connectionState == ConnectionState.waiting) {
          return Container(
            width: size,
            height: size,
            color: Colors.grey[300],
            child: const Center(
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          );
        }

        LoggingService.warning('Avatar: Failed to load avatar for actorId=$actorId, src="$src"');
        return _buildPlaceholderAvatar();
      },
    );
  }

  Widget _buildPlaceholderAvatar() {
    final letter = _getFirstLetter(fallbackName);
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
