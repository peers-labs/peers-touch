import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_desktop/features/social/model/post_model.dart';

class SocialApiService {
  final IHttpService _httpService = HttpServiceLocator().httpService;

  Future<Post> createPost(Map<String, dynamic> request) async {
    final response = await _httpService.postResponse<Map<String, dynamic>>(
      '/api/v1/social/posts',
      data: request,
    );
    
    return Post.fromJson(response.data!);
  }

  Future<Post> getPost(String postId) async {
    final response = await _httpService.getResponse<Map<String, dynamic>>(
      '/api/v1/social/posts/$postId',
    );
    
    return Post.fromJson(response.data!);
  }

  Future<Post> updatePost(String postId, Map<String, dynamic> request) async {
    final response = await _httpService.putResponse<Map<String, dynamic>>(
      '/api/v1/social/posts/$postId',
      data: request,
    );
    
    return Post.fromJson(response.data!);
  }

  Future<void> deletePost(String postId) async {
    await _httpService.delete(
      '/api/v1/social/posts/$postId',
    );
  }

  Future<void> likePost(String postId) async {
    await _httpService.post(
      '/api/v1/social/posts/$postId/like',
    );
  }

  Future<void> unlikePost(String postId) async {
    await _httpService.post(
      '/api/v1/social/posts/$postId/unlike',
    );
  }

  Future<TimelineResponse> getTimeline({
    String? cursor,
    int limit = 20,
  }) async {
    final response = await _httpService.getResponse<Map<String, dynamic>>(
      '/api/v1/social/timeline',
      queryParameters: {
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
    );
    
    return TimelineResponse.fromJson(response.data!);
  }
}
