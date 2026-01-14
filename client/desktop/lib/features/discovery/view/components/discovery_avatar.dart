import 'package:flutter/material.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

/// A standardized Avatar component for the Discovery feature.
/// Handles:
/// 1. Valid Image URL -> Shows Image
/// 2. Loading -> Shows Skeleton/Shimmer
/// 3. Error/Empty -> Shows Placeholder Icon or Initials
class DiscoveryAvatar extends StatelessWidget {

  const DiscoveryAvatar({
    super.key,
    this.url,
    this.fallbackName = 'User',
    this.radius = 20,
  });
  final String? url;
  final String fallbackName;
  final double radius;

  String _getFullUrl(String url) {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('/')) {
      final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
      return '$baseUrl$url';
    }
    return url;
  }

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) {
      return _buildPlaceholder();
    }

    final fullUrl = _getFullUrl(url!);

    return ClipOval(
      child: Image.network(
        fullUrl,
        width: radius * 2,
        height: radius * 2,
        fit: BoxFit.cover,
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return _buildSkeleton();
        },
        errorBuilder: (context, error, stackTrace) {
          return _buildPlaceholder();
        },
      ),
    );
  }

  Widget _buildPlaceholder() {
    return Container(
      width: radius * 2,
      height: radius * 2,
      decoration: BoxDecoration(
        color: Colors.grey[300],
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        fallbackName.isNotEmpty ? fallbackName.substring(0, 1).toUpperCase() : 'U',
        style: TextStyle(
          fontSize: radius,
          fontWeight: FontWeight.bold,
          color: Colors.white,
        ),
      ),
    );
  }

  Widget _buildSkeleton() {
    return Container(
      width: radius * 2,
      height: radius * 2,
      decoration: BoxDecoration(
        color: Colors.grey[200],
        shape: BoxShape.circle,
      ),
    );
  }
}
