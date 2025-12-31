class DiscoveryComment {

  DiscoveryComment({
    required this.id,
    required this.authorName,
    required this.authorAvatar,
    required this.content,
    required this.timestamp,
  });
  final String id;
  final String authorName;
  final String authorAvatar;
  final String content;
  final DateTime timestamp;
}

class DiscoveryItem {

  DiscoveryItem({
    required this.id,
    required this.objectId,
    required this.title,
    required this.content,
    required this.author,
    required this.timestamp,
    required this.type,
    this.authorAvatar = '',
    this.images = const [],
    this.likesCount = 0,
    this.commentsCount = 0,
    this.sharesCount = 0,
    this.isLiked = false,
    List<DiscoveryComment>? comments,
  }) : comments = comments ?? [];
  final String id;
  final String objectId;
  final String title;
  final String content;
  final String author;
  final String authorAvatar;
  final DateTime timestamp;
  final String type; // 'post', 'group', 'user'
  final List<String> images;
  
  // Stats (mutable for real-time updates)
  int likesCount;
  int commentsCount;
  int sharesCount;
  
  // Interaction state (mutable for UI)
  bool isLiked;
  
  // Comments
  final List<DiscoveryComment> comments;
}
