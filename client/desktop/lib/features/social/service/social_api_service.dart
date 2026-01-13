import 'package:peers_touch_base/model/domain/social/post.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class SocialApiService {
  final IHttpService _httpService = HttpServiceLocator().httpService;

  Future<Post> createPost(CreatePostRequest request) async {
    return await _httpService.post<Post>(
      '/api/v1/social/posts',
      data: request,
      fromJson: (bytes) => Post.fromBuffer(bytes),
    );
  }

  Future<Post> getPost(String postId) async {
    return await _httpService.get<Post>(
      '/api/v1/social/posts/$postId',
      fromJson: (bytes) => Post.fromBuffer(bytes),
    );
  }

  Future<Post> updatePost(String postId, Map<String, dynamic> request) async {
    return await _httpService.put<Post>(
      '/api/v1/social/posts/$postId',
      data: request,
      fromJson: (bytes) => Post.fromBuffer(bytes),
    );
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

  Future<GetTimelineResponse> getTimeline({
    TimelineType type = TimelineType.TIMELINE_PUBLIC,
    String? cursor,
    int limit = 20,
  }) async {
    print('[SocialApiService] getTimeline called with type=${type.value} (${type.name}), limit=$limit');
    return await _httpService.get<GetTimelineResponse>(
      '/api/v1/social/timeline',
      queryParameters: {
        'type': type.value,
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
      fromJson: (bytes) => GetTimelineResponse.fromBuffer(bytes),
    );
  }
}
