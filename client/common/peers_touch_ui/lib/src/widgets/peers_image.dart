import 'dart:io';

import 'package:flutter/material.dart';
import 'package:peers_touch_base/storage/remote_image_cache_service.dart';

class PeersImage extends StatelessWidget {
  const PeersImage({
    super.key,
    required this.src,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.alignment = Alignment.center,
    this.placeholder,
    this.error,
    this.maxAge = const Duration(days: 30),
  });

  final String? src;
  final double? width;
  final double? height;
  final BoxFit fit;
  final Alignment alignment;
  final Widget? placeholder;
  final Widget? error;
  final Duration maxAge;

  @override
  Widget build(BuildContext context) {
    final s = src?.trim() ?? '';
    if (s.isEmpty) {
      return SizedBox(width: width, height: height, child: error ?? const SizedBox.shrink());
    }

    final future = RemoteImageCacheService().getOrFetch(s, maxAge: maxAge);
    return FutureBuilder<File?>(
      future: future,
      builder: (context, snapshot) {
        final file = snapshot.data;
        if (file != null) {
          return Image.file(
            file,
            width: width,
            height: height,
            fit: fit,
            alignment: alignment,
          );
        }

        if (snapshot.connectionState == ConnectionState.waiting) {
          return SizedBox(width: width, height: height, child: placeholder ?? const SizedBox.shrink());
        }

        return SizedBox(width: width, height: height, child: error ?? const SizedBox.shrink());
      },
    );
  }
}

