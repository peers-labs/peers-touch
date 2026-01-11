import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/social/post.pb.dart';
import 'package:peers_touch_desktop/features/social/controller/timeline_controller.dart';

class TimelinePage extends GetView<TimelineController> {
  const TimelinePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('时间线'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => controller.loadTimeline(refresh: true),
          ),
        ],
      ),
      body: Obx(() {
        if (controller.isLoading.value && controller.posts.isEmpty) {
          return const Center(child: CircularProgressIndicator());
        }

        if (controller.posts.isEmpty) {
          return const Center(
            child: Text('暂无帖子'),
          );
        }

        return RefreshIndicator(
          onRefresh: () => controller.loadTimeline(refresh: true),
          child: ListView.builder(
            itemCount: controller.posts.length + 1,
            itemBuilder: (context, index) {
              if (index == controller.posts.length) {
                if (controller.hasMore.value) {
                  controller.loadTimeline();
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(16.0),
                      child: CircularProgressIndicator(),
                    ),
                  );
                }
                return const SizedBox.shrink();
              }

              final post = controller.posts[index];
              return _PostCard(post: post);
            },
          ),
        );
      }),
    );
  }
}

class _PostCard extends GetView<TimelineController> {
  final Post post;

  const _PostCard({required this.post});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  child: Text(post.author.displayName.isNotEmpty 
                      ? post.author.displayName.substring(0, 1) 
                      : post.author.username.substring(0, 1)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        post.author.displayName.isNotEmpty 
                            ? post.author.displayName 
                            : post.author.username,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      Text(
                        '@${post.author.username}',
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 14,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  _formatTimestamp(post.createdAt.toDateTime()),
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 12,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_getPostText(post).isNotEmpty)
              Text(
                _getPostText(post),
                style: const TextStyle(fontSize: 15),
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                _ActionButton(
                  icon: post.interaction.isLiked
                      ? Icons.favorite
                      : Icons.favorite_border,
                  label: '${post.stats.likesCount}',
                  color: post.interaction.isLiked ? Colors.red : null,
                  onTap: () {
                    if (post.interaction.isLiked) {
                      controller.unlikePost(post.id);
                    } else {
                      controller.likePost(post.id);
                    }
                  },
                ),
                const SizedBox(width: 24),
                _ActionButton(
                  icon: Icons.comment_outlined,
                  label: '${post.stats.commentsCount}',
                  onTap: () {},
                ),
                const SizedBox(width: 24),
                _ActionButton(
                  icon: Icons.repeat,
                  label: '${post.stats.repostsCount}',
                  onTap: () {},
                ),
                const Spacer(),
                PopupMenuButton(
                  itemBuilder: (context) => [
                    const PopupMenuItem(
                      value: 'delete',
                      child: Text('删除'),
                    ),
                  ],
                  onSelected: (value) {
                    if (value == 'delete') {
                      controller.deletePost(post.id);
                    }
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _getPostText(Post post) {
    switch (post.whichContent()) {
      case Post_Content.textPost:
        return post.textPost.text;
      case Post_Content.imagePost:
        return post.imagePost.text;
      case Post_Content.videoPost:
        return post.videoPost.text;
      case Post_Content.linkPost:
        return post.linkPost.text;
      case Post_Content.pollPost:
        return post.pollPost.text;
      case Post_Content.repostPost:
        return post.repostPost.comment;
      case Post_Content.locationPost:
        return post.locationPost.text;
      default:
        return '';
    }
  }

  String _formatTimestamp(DateTime timestamp) {
    final now = DateTime.now();
    final difference = now.difference(timestamp);

    if (difference.inMinutes < 1) {
      return '刚刚';
    } else if (difference.inHours < 1) {
      return '${difference.inMinutes}分钟前';
    } else if (difference.inDays < 1) {
      return '${difference.inHours}小时前';
    } else if (difference.inDays < 7) {
      return '${difference.inDays}天前';
    } else {
      return '${timestamp.month}月${timestamp.day}日';
    }
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color? color;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          children: [
            Icon(icon, size: 20, color: color),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(color: color),
            ),
          ],
        ),
      ),
    );
  }
}
