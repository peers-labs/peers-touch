import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/model/domain/activity/activity.pb.dart' as pb;

class DiscoveryRepository {
  final _httpService = HttpServiceLocator().httpService;

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
