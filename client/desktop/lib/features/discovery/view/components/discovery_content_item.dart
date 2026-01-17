import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/peers_touch_base.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';

class DiscoveryContentItem extends StatelessWidget {

  DiscoveryContentItem({
    super.key,
    required this.item,
    this.controller,
  }) {
    LoggingService.debug('DiscoveryContentItem constructor: id=${item.id}, commentsCount=${item.commentsCount}, isExpanded=${item.isCommentsExpanded}, comments.length=${item.comments.length}');
    
    if (item.commentsCount > 0 && !item.isCommentsExpanded && item.comments.isEmpty) {
      LoggingService.debug('DiscoveryContentItem: Auto-expanding comments for item ${item.id}');
      WidgetsBinding.instance.addPostFrameCallback((_) {
        item.isCommentsExpanded = true;
        controller?.loadComments(item);
        controller?.update(['item_${item.id}']);
      });
    }
  }
  
  final DiscoveryItem item;
  final DiscoveryController? controller;
  final TextEditingController commentController = TextEditingController();

  @override
  Widget build(BuildContext context) {
    return GetBuilder<DiscoveryController>(
      id: 'item_${item.id}',
      builder: (_) {
        return Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 12,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(context),
          _buildContent(),
          const SizedBox(height: 8),
          _buildActions(context),
              item.isCommentsExpanded 
                ? _buildCommentsSection(context) 
                : const SizedBox.shrink(),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHeader(BuildContext context) {
    LoggingService.debug('DiscoveryContentItem._buildHeader: item.id=${item.id}, authorId="${item.authorId}", authorAvatar="${item.authorAvatar}", author="${item.author}"');
    
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(
        children: [
          Avatar(
            actorId: item.authorId,
            avatarUrl: item.authorAvatar,
            fallbackName: item.author,
            size: 40,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Text(
                      item.author,
                      style: const TextStyle(
                        color: Colors.grey,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(width: 8),
                    const Icon(Icons.circle, size: 4, color: Colors.grey),
                    const SizedBox(width: 8),
                    Text(
                      '${_getMonth(item.timestamp)} ${item.timestamp.day}',
                      style: const TextStyle(
                        color: Colors.grey,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_horiz, color: Colors.grey),
            onSelected: (value) {
              if (value == 'delete') {
                controller?.deleteItem(item);
              }
            },
            itemBuilder: (BuildContext context) {
              return [
                const PopupMenuItem<String>(
                  value: 'delete',
                  child: Row(
                    children: [
                      Icon(Icons.delete, color: Colors.red, size: 20),
                      SizedBox(width: 8),
                      Text('Delete', style: TextStyle(color: Colors.red)),
                    ],
                  ),
                ),
              ];
            },
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (item.content.isNotEmpty)
            Text(
              item.content,
              maxLines: 5,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.grey[600],
                height: 1.5,
              ),
            ),
          if (item.images.isNotEmpty) ...[
            const SizedBox(height: 12),
            _buildImageGrid(item.images),
          ],
        ],
      ),
    );
  }

  Widget _buildActions(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          const Spacer(),
          
          // Like Action
          _buildActionItem(
            icon: Icons.local_fire_department,
            color: Colors.orange,
            count: item.likesCount,
            onTap: () => controller?.likeItem(item),
          ),
          const SizedBox(width: 16),
          
          // Comment Action
          _buildActionItem(
            icon: Icons.chat_bubble_outline,
            color: Colors.blue,
            count: item.commentsCount,
            onTap: () {
              item.isCommentsExpanded = !item.isCommentsExpanded;
              controller?.update(['item_${item.id}']);
              if (item.isCommentsExpanded && item.comments.isEmpty && item.commentsCount > 0) {
                controller?.loadComments(item);
              }
            },
          ),
          const SizedBox(width: 16),
          
          // Share Action
          _buildActionItem(
            icon: Icons.share,
            color: Colors.cyan,
            count: item.sharesCount,
            onTap: () => controller?.announceItem(item),
          ),
        ],
      ),
    );
  }
  
  Widget _buildActionItem({
    required IconData icon, 
    required Color color, 
    required int count,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
        child: Row(
          children: [
            Icon(icon, color: color, size: 18),
            const SizedBox(width: 4),
            Text(
              '$count',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCommentsSection(BuildContext context) {
    String myActorId = '';
    String myName = 'Me';
    String? myAvatarUrl;
    
    if (Get.isRegistered<GlobalContext>()) {
      final ctx = Get.find<GlobalContext>();
      final session = ctx.currentSession;
      if (session != null) {
        myActorId = session['actorId']?.toString() ?? '';
        myName = session['handle']?.toString() ?? 'Me';
        myAvatarUrl = session['avatarUrl']?.toString();
      }
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey[50],
        borderRadius: const BorderRadius.only(
          bottomLeft: Radius.circular(16),
          bottomRight: Radius.circular(16),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Input
          Row(
            children: [
              Avatar(
                actorId: myActorId,
                avatarUrl: myAvatarUrl,
                fallbackName: myName,
                size: 28,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: Colors.grey[300]!),
                  ),
                  child: TextField(
                    controller: commentController,
                    style: const TextStyle(fontSize: 14),
                    decoration: const InputDecoration(
                      hintText: 'Write a comment...',
                      hintStyle: TextStyle(fontSize: 14),
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                    onSubmitted: (value) {
                      if (value.isNotEmpty) {
                        controller?.replyToItem(item, value);
                        commentController.clear();
                      }
                    },
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.send, color: Colors.blue),
                onPressed: () {
                  if (commentController.text.isNotEmpty) {
                    controller?.replyToItem(item, commentController.text);
                    commentController.clear();
                  }
                },
              ),
            ],
          ),
          
          if (item.comments.isNotEmpty) ...[
            const SizedBox(height: 12),
            const Divider(height: 1),
            const SizedBox(height: 8),
            Builder(
              builder: (context) {
                LoggingService.debug('DiscoveryContentItem: Rendering ${item.comments.length} comments for item ${item.id}');
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: item.comments.map((c) => _buildCommentItem(c)).toList(),
                );
              },
            ),
            if (item.hasMoreComments)
              Padding(
                padding: const EdgeInsets.only(top: 8.0),
                child: item.loadingMoreComments
                  ? const Center(
                      child: Padding(
                        padding: EdgeInsets.all(8.0),
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    )
                  : GestureDetector(
                      onTap: () {
                        controller?.loadMoreComments(item);
                      },
                      child: Text(
                        'Load more comments...',
                        style: TextStyle(
                          color: Colors.blue[600],
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
              ),
          ],
        ],
      ),
    );
  }

  Widget _buildCommentItem(DiscoveryComment comment) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Avatar(
            actorId: comment.authorId,
            avatarUrl: comment.authorAvatar,
            fallbackName: comment.authorName,
            size: 24,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      comment.authorName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      _getTimeAgo(comment.timestamp),
                      style: TextStyle(
                        color: Colors.grey[500],
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  comment.content,
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey[800],
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Helper Methods
  Color _getTypeColor(String type) {
    switch (type.toLowerCase()) {
      case 'create': return Colors.blue;
      case 'like': return Colors.pink;
      case 'follow': return Colors.purple;
      case 'announce': return Colors.green;
      case 'comment': return Colors.orange;
      default: return Colors.cyanAccent;
    }
  }

  String _getMonth(DateTime date) {
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return months[date.month - 1];
  }
  
  String _getTimeAgo(DateTime date) {
    final diff = DateTime.now().difference(date);
    if (diff.inDays > 0) return '${diff.inDays}d';
    if (diff.inHours > 0) return '${diff.inHours}h';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m';
    return 'now';
  }

  Widget _buildImageGrid(List<String> images) {
    if (images.isEmpty) return const SizedBox.shrink();

    if (images.length == 1) {
      // WeChat style: 
      // - Max width/height limited (e.g. 2/3 screen width)
      // - Preserve aspect ratio if possible
      // - If very tall/wide, crop? WeChat crops very tall images.
      // Here we set a reasonable constraint.
      return ConstrainedBox(
        constraints: const BoxConstraints(
          maxWidth: 240, // Reduced from full width
          maxHeight: 240,
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.network(
            images.first,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => const SizedBox.shrink(),
          ),
        ),
      );
    }

    final count = images.length > 9 ? 9 : images.length;
    // 4 images case: 2x2 grid
    if (count == 4) {
      return SizedBox(
        width: 240, // Constrain width for 2x2
        child: GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 2,
          mainAxisSpacing: 4,
          crossAxisSpacing: 4,
          childAspectRatio: 1.0,
          children: images.take(4).map((url) => _buildGridImage(url)).toList(),
        ),
      );
    }

    // Standard 3-column grid
    return SizedBox(
      width: 360, // Constrain width for 3-column (approx 3 * 120)
      child: GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 3,
        mainAxisSpacing: 4,
        crossAxisSpacing: 4,
        childAspectRatio: 1.0,
        children: images.take(count).map((url) => _buildGridImage(url)).toList(),
      ),
    );
  }

  Widget _buildGridImage(String url) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(4),
      child: Image.network(
        url,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => Container(color: Colors.grey[200]),
      ),
    );
  }
}
