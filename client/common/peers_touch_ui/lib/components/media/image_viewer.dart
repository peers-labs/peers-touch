import 'package:flutter/material.dart';

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
    this.baseUrl,
  });

  final String? src;
  final double? width;
  final double? height;
  final BoxFit fit;
  final Alignment alignment;
  final Widget? placeholder;
  final Widget? error;
  final String? baseUrl;

  static String? _globalBaseUrl;
  
  static void setGlobalBaseUrl(String baseUrl) {
    _globalBaseUrl = baseUrl;
  }

  String _resolveImageUrl(String url) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    if (url.startsWith('/')) {
      final base = baseUrl ?? _globalBaseUrl ?? 'http://localhost:8080';
      return '$base$url';
    }
    
    return url;
  }

  @override
  Widget build(BuildContext context) {
    final s = src?.trim() ?? '';
    if (s.isEmpty) {
      return SizedBox(width: width, height: height, child: error ?? const SizedBox.shrink());
    }

    final resolvedUrl = _resolveImageUrl(s);

    return Image.network(
      resolvedUrl,
      width: width,
      height: height,
      fit: fit,
      alignment: alignment,
      loadingBuilder: (context, child, loadingProgress) {
        if (loadingProgress == null) {
          return child;
        }
        return placeholder ?? const Center(child: CircularProgressIndicator());
      },
      errorBuilder: (context, error, stackTrace) {
        return this.error ?? const Icon(Icons.error);
      },
    );
  }
}
