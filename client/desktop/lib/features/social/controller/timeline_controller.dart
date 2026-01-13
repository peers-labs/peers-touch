import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/social/post.pb.dart';
import 'package:peers_touch_desktop/features/social/service/social_api_service.dart';

class TimelineController extends GetxController {
  final SocialApiService _apiService = SocialApiService();

  final posts = <Post>[].obs;
  final isLoading = false.obs;
  final hasMore = true.obs;
  String? _nextCursor;

  @override
  void onInit() {
    super.onInit();
    loadTimeline();
  }

  Future<void> loadTimeline({bool refresh = false}) async {
    if (isLoading.value) return;
    
    if (refresh) {
      _nextCursor = null;
      posts.clear();
      hasMore.value = true;
    }

    if (!hasMore.value) return;

    try {
      isLoading.value = true;
      
      final response = await _apiService.getTimeline(
        type: TimelineType.TIMELINE_PUBLIC,
        cursor: _nextCursor,
        limit: 20,
      );

      if (refresh) {
        posts.value = response.posts;
      } else {
        posts.addAll(response.posts);
      }

      _nextCursor = response.nextCursor;
      hasMore.value = response.hasMore;
    } catch (e) {
      LoggingService.error('Failed to load timeline: $e');
      Get.snackbar('错误', '加载时间线失败');
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> likePost(String postId) async {
    try {
      final index = posts.indexWhere((p) => p.id == postId);
      if (index != -1) {
        final post = posts[index];
        final updatedPost = post.deepCopy();
        updatedPost.stats.likesCount += 1;
        updatedPost.interaction.isLiked = true;
        posts[index] = updatedPost;
      }
      
      await _apiService.likePost(postId);
    } catch (e) {
      LoggingService.error('Failed to like post: $e');
      Get.snackbar('错误', '点赞失败');
      loadTimeline(refresh: true);
    }
  }

  Future<void> unlikePost(String postId) async {
    try {
      final index = posts.indexWhere((p) => p.id == postId);
      if (index != -1) {
        final post = posts[index];
        final updatedPost = post.deepCopy();
        updatedPost.stats.likesCount -= 1;
        updatedPost.interaction.isLiked = false;
        posts[index] = updatedPost;
      }
      
      await _apiService.unlikePost(postId);
    } catch (e) {
      LoggingService.error('Failed to unlike post: $e');
      Get.snackbar('错误', '取消点赞失败');
      loadTimeline(refresh: true);
    }
  }

  Future<void> deletePost(String postId) async {
    try {
      await _apiService.deletePost(postId);
      posts.removeWhere((p) => p.id == postId);
      Get.snackbar('成功', '帖子已删除');
    } catch (e) {
      LoggingService.error('Failed to delete post: $e');
      Get.snackbar('错误', '删除失败');
    }
  }
}
