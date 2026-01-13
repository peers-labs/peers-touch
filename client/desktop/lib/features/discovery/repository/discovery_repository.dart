import 'package:peers_touch_base/model/domain/activity/activity.pb.dart' as pb;
import 'package:peers_touch_base/model/domain/social/post.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import '../../social/service/social_api_service.dart';

class DiscoveryRepository {
  // Don't cache httpService, always get the latest instance from locator
  // This ensures we use the updated instance after auth setup
  IHttpService get _httpService => HttpServiceLocator().httpService;
  final SocialApiService _socialApiService = SocialApiService();

  /// Fetch user's outbox
  Future<Map<String, dynamic>> fetchOutbox(String username, {bool page = true}) async {
    final data = await _httpService.get<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      queryParameters: {'page': page},
    );
    return data;
  }

  /// Submit a activity to outbox using Proto structure
  Future<Map<String, dynamic>> submitActivity(String username, pb.ActivityInput input) async {
    final activity = _convertToActivityPub(username, input);
    final data = await _httpService.post<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      data: activity,
    );
    return data;
  }

  /// Fetch timeline using new Social API
  Future<GetTimelineResponse> fetchTimeline({
    TimelineType type = TimelineType.TIMELINE_PUBLIC,
    String? cursor,
    int limit = 20,
  }) async {
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

  /// Fetch user's posts using new Social API
  Future<ListPostsResponse> fetchUserPosts(String userId, {String? cursor, int limit = 20}) async {
    return await _httpService.get<ListPostsResponse>(
      '/api/v1/social/users/$userId/posts',
      queryParameters: {
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
      fromJson: (bytes) => ListPostsResponse.fromBuffer(bytes),
    );
  }

  /// Create a post using new Social API
  Future<Post> createPost({
    required String text,
    List<String>? mediaUrls,
    String? replyTo,
    String visibility = 'public',
  }) async {
    // Determine post type based on content
    final bool hasMedia = mediaUrls != null && mediaUrls.isNotEmpty;
    final PostType postType = hasMedia ? PostType.IMAGE : PostType.TEXT;
    
    // Map visibility to Proto enum
    final PostVisibility visibilityEnum = _mapVisibilityToEnum(visibility);
    
    // Build Proto request
    final CreatePostRequest request = CreatePostRequest(
      type: postType,
      visibility: visibilityEnum,
    );
    
    if (replyTo != null && replyTo.isNotEmpty) {
      request.replyToPostId = replyTo;
    }
    
    // Add content based on type
    if (hasMedia) {
      request.image = CreateImagePostRequest(
        text: text,
        imageIds: mediaUrls,
      );
    } else {
      request.text = CreateTextPostRequest(
        text: text,
      );
    }
    
    return await _socialApiService.createPost(request);
  }
  
  String _mapVisibility(String visibility) {
    switch (visibility.toLowerCase()) {
      case 'public':
        return 'PUBLIC';
      case 'followers':
      case 'followers_only':
        return 'FOLLOWERS_ONLY';
      case 'private':
      case 'direct':
        return 'PRIVATE';
      default:
        return 'PUBLIC';
    }
  }

  PostVisibility _mapVisibilityToEnum(String visibility) {
    switch (visibility.toLowerCase()) {
      case 'public':
        return PostVisibility.PUBLIC;
      case 'followers':
      case 'followers_only':
        return PostVisibility.FOLLOWERS_ONLY;
      case 'private':
      case 'direct':
        return PostVisibility.PRIVATE;
      default:
        return PostVisibility.PUBLIC;
    }
  }

  /// Delete a post using new Social API
  Future<void> deletePost(String postId) async {
    await _httpService.delete(
      '/api/v1/social/posts/$postId',
    );
  }

  /// Like a post using new Social API
  Future<void> likePost(String postId) async {
    await _httpService.post(
      '/api/v1/social/posts/$postId/like',
    );
  }

  /// Unlike a post using new Social API
  Future<void> unlikePost(String postId) async {
    await _httpService.post(
      '/api/v1/social/posts/$postId/unlike',
    );
  }

  /// Repost a post using new Social API
  Future<Post> repostPost(String postId) async {
    return await _httpService.post<Post>(
      '/api/v1/social/posts/$postId/repost',
      fromJson: (bytes) => Post.fromBuffer(bytes),
    );
  }

  /// @deprecated Use deletePost instead
  Future<void> deleteActivity(String username, String objectId) async {
    final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
    final actorId = '$baseUrl/activitypub/$username/actor';
    
    final activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      'type': 'Delete',
      'actor': actorId,
      'object': objectId,
    };

    await _httpService.post<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      data: activity,
    );
  }

  Future<void> likeActivity(String username, String objectId) async {
    final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
    final actorId = '$baseUrl/activitypub/$username/actor';
    
    final activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      'type': 'Like',
      'actor': actorId,
      'object': objectId,
    };

    await _httpService.post<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      data: activity,
    );
  }

  Future<void> announceActivity(String username, String objectId) async {
    final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
    final actorId = '$baseUrl/activitypub/$username/actor';
    const public = 'https://www.w3.org/ns/activitystreams#Public';
    final followers = '$baseUrl/activitypub/$username/followers';

    final activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      'type': 'Announce',
      'actor': actorId,
      'object': objectId,
      'to': [public],
      'cc': [followers],
    };

    await _httpService.post<Map<String, dynamic>>(
      '/activitypub/$username/outbox',
      data: activity,
    );
  }

  Future<Map<String, dynamic>> fetchObjectReplies(String objectId, {bool page = true}) async {
    final data = await _httpService.get<Map<String, dynamic>>(
      '/activitypub/objects/$objectId/replies',
      queryParameters: {'page': page},
    );
    return data;
  }

  Future<Map<String, dynamic>> fetchActorList() async {
    final data = await _httpService.get<Map<String, dynamic>>(
      '/activitypub/list',
    );
    return data;
  }

  Future<Map<String, dynamic>> fetchInbox(String username, {bool page = true}) async {
    final data = await _httpService.get<Map<String, dynamic>>(
      '/activitypub/$username/inbox',
      queryParameters: {'page': page},
    );
    return data;
  }

  Future<Map<String, dynamic>> fetchFollowing(String username, {bool page = true}) async {
    final data = await _httpService.get<Map<String, dynamic>>(
      '/activitypub/$username/following',
      queryParameters: {'page': page},
    );
    return data;
  }

  Future<Map<String, dynamic>> searchActors(String query) async {
    final data = await _httpService.get<Map<String, dynamic>>(
      '/activitypub/search',
      queryParameters: {'q': query},
    );
    return data;
  }

  Future<void> followUser(String currentUsername, String targetUsername) async {
    final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
    final actorId = '$baseUrl/activitypub/$currentUsername/actor';
    final targetActorId = '$baseUrl/activitypub/$targetUsername/actor';

    final activity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      'type': 'Follow',
      'actor': actorId,
      'object': targetActorId,
    };

    await _httpService.post<Map<String, dynamic>>(
      '/activitypub/$currentUsername/outbox',
      data: activity,
    );
  }

  Map<String, dynamic> _convertToActivityPub(String username, pb.ActivityInput input) {
    final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
    final actorId = '$baseUrl/activitypub/$username/actor';
    final followers = '$baseUrl/activitypub/$username/followers';
    const public = 'https://www.w3.org/ns/activitystreams#Public';

    // Determine Audience (To/CC)
    final to = <String>[];
    final cc = <String>[];

    final visibility = input.hasVisibility() ? input.visibility.toLowerCase() : 'public';
    
    switch (visibility) {
      case 'public':
        to.add(public);
        cc.add(followers);
        break;
      case 'unlisted':
        to.add(followers);
        cc.add(public);
        break;
      case 'followers':
        to.add(followers);
        break;
      case 'direct':
        // Direct messages don't add followers or public
        break;
      default:
        to.add(public);
        cc.add(followers);
    }

    // Add specific audience members
    if (input.audience.isNotEmpty) {
      to.addAll(input.audience);
    }
    
    // Add reply-to author to TO if not present (optional logic, but good practice)
    // Note: PostInput doesn't carry reply-to author IRI, only replyTo ID.
    // If replyTo ID is an IRI, we might want to extract authority, but usually 
    // the caller should add the author to 'audience' if needed.
    // We'll rely on input.audience for explicit mentions.

    // Build Note Object
    final note = <String, dynamic>{
      'type': 'Note',
      'content': input.text,
      'attributedTo': actorId,
      'to': to,
      'cc': cc,
      'published': input.hasClientTime() 
          ? input.clientTime.toDateTime().toIso8601String() 
          : DateTime.now().toIso8601String(),
    };

    if (input.hasReplyTo() && input.replyTo.isNotEmpty) {
      note['inReplyTo'] = input.replyTo;
    }

    if (input.hasCw() && input.cw.isNotEmpty) {
      note['summary'] = input.cw;
    }
    
    if (input.hasSensitive()) {
      note['sensitive'] = input.sensitive;
    }

    // Attachments
    if (input.attachments.isNotEmpty) {
      note['attachment'] = input.attachments.map((att) {
        final isImage = att.mediaType.startsWith('image/');
        return {
          'type': isImage ? 'Image' : 'Document',
          'mediaType': att.mediaType,
          'url': att.url,
          'name': att.alt,
        };
      }).toList();
      
      // If no text but has image, change root type? 
      // ActivityPub allows Note to have attachments. 
      // Some servers use 'Image' type for pure image posts, but 'Note' with attachment is more standard for text+image.
    }

    // Build Activity
    final activity = <String, dynamic>{
      '@context': 'https://www.w3.org/ns/activitystreams',
      'type': 'Create',
      'actor': actorId,
      'object': note,
      'to': to,
      'cc': cc,
    };

    return activity;
  }
}
