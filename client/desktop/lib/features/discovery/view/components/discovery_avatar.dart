import 'package:flutter/material.dart';

/// A standardized Avatar component for the Discovery feature.
/// Handles:
/// 1. Valid Image URL -> Shows Image
/// 2. Loading -> Shows Skeleton/Shimmer
/// 3. Error/Empty -> Shows Placeholder Icon or Initials
class DiscoveryAvatar extends StatelessWidget {
  final String? url;
  final String fallbackName;
  final double radius;

  const DiscoveryAvatar({
    super.key,
    this.url,
    this.fallbackName = 'User',
    this.radius = 20,
  });

  @override
  Widget build(BuildContext context) {
    // 1. Empty State Check
    if (url == null || url!.isEmpty) {
      return _buildPlaceholder();
    }

    return ClipOval(
      child: Image.network(
        url!,
        width: radius * 2,
        height: radius * 2,
        fit: BoxFit.cover,
        // 2. Loading State
        loadingBuilder: (context, child, loadingProgress) {
          if (loadingProgress == null) return child;
          return _buildSkeleton();
        },
        // 3. Error State
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
