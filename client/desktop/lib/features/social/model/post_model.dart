class Post {
  final String id;
  final String authorId;
  final PostAuthor author;
  final PostContent content;
  final PostStats stats;
  final PostInteraction interaction;
  final DateTime createdAt;
  final DateTime updatedAt;

  Post({
    required this.id,
    required this.authorId,
    required this.author,
    required this.content,
    required this.stats,
    required this.interaction,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Post.fromJson(Map<String, dynamic> json) {
    return Post(
      id: json['id'] as String? ?? '',
      authorId: json['author_id'] as String? ?? '',
      author: PostAuthor.fromJson(json['author'] as Map<String, dynamic>? ?? {}),
      content: PostContent.fromJson(json['content'] as Map<String, dynamic>? ?? {}),
      stats: PostStats.fromJson(json['stats'] as Map<String, dynamic>? ?? {}),
      interaction: PostInteraction.fromJson(json['interaction'] as Map<String, dynamic>? ?? {}),
      createdAt: DateTime.parse(json['created_at'] as String? ?? DateTime.now().toIso8601String()),
      updatedAt: DateTime.parse(json['updated_at'] as String? ?? DateTime.now().toIso8601String()),
    );
  }
}

class PostAuthor {
  final String id;
  final String name;
  final String preferredUsername;
  final String? avatarUrl;

  PostAuthor({
    required this.id,
    required this.name,
    required this.preferredUsername,
    this.avatarUrl,
  });

  factory PostAuthor.fromJson(Map<String, dynamic> json) {
    return PostAuthor(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      preferredUsername: json['preferred_username'] as String? ?? '',
      avatarUrl: json['avatar_url'] as String?,
    );
  }
}

class PostContent {
  final String? text;
  final List<String>? mediaUrls;

  PostContent({
    this.text,
    this.mediaUrls,
  });

  factory PostContent.fromJson(Map<String, dynamic> json) {
    return PostContent(
      text: json['text'] as String?,
      mediaUrls: (json['media_urls'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );
  }

  bool get hasText => text != null && text!.isNotEmpty;
}

class PostStats {
  final int likesCount;
  final int repliesCount;
  final int repostsCount;

  PostStats({
    required this.likesCount,
    required this.repliesCount,
    required this.repostsCount,
  });

  factory PostStats.fromJson(Map<String, dynamic> json) {
    return PostStats(
      likesCount: json['likes_count'] as int? ?? 0,
      repliesCount: json['replies_count'] as int? ?? 0,
      repostsCount: json['reposts_count'] as int? ?? 0,
    );
  }
}

class PostInteraction {
  final bool isLiked;
  final bool isReposted;

  PostInteraction({
    required this.isLiked,
    required this.isReposted,
  });

  factory PostInteraction.fromJson(Map<String, dynamic> json) {
    return PostInteraction(
      isLiked: json['is_liked'] as bool? ?? false,
      isReposted: json['is_reposted'] as bool? ?? false,
    );
  }
}

class TimelineResponse {
  final List<Post> posts;
  final String? nextCursor;
  final bool hasMore;

  TimelineResponse({
    required this.posts,
    this.nextCursor,
    required this.hasMore,
  });

  factory TimelineResponse.fromJson(Map<String, dynamic> json) {
    return TimelineResponse(
      posts: (json['posts'] as List<dynamic>?)
              ?.map((e) => Post.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      nextCursor: json['next_cursor'] as String?,
      hasMore: json['has_more'] as bool? ?? false,
    );
  }
}
