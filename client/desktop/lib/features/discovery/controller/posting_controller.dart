import 'dart:io';

import 'package:get/get.dart';
import 'package:dio/dio.dart' as dio;
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/post/post.pb.dart' as pb;

import 'package:peers_touch_base/context/global_context.dart';

class PostingController extends GetxController {
  final ApiClient _api = Get.find<ApiClient>();
  final GlobalContext _gctx = Get.find<GlobalContext>();
  String? overrideActor;
  
  final submitting = false.obs;
  final errorText = RxnString();

  // Form State
  final text = ''.obs;
  final cw = ''.obs;
  final cwEnabled = false.obs;
  final visibility = 'public'.obs;
  final attachments = <File>[].obs;
  // TODO: Add Poll state


  void setActor(String name) => overrideActor = name;

  String get _actor {
    final handle = _gctx.actorHandle ?? _gctx.currentSession?['username']?.toString();
    final name = (overrideActor ?? handle ?? '').trim();
    return name.isEmpty ? 'dev' : name;
  }

  void toggleCW() {
    cwEnabled.value = !cwEnabled.value;
    if (!cwEnabled.value) {
      cw.value = '';
    }
  }

  void setVisibility(String v) => visibility.value = v;

  void addAttachment(File file) {
    if (attachments.length < 4) {
      attachments.add(file);
    }
  }

  void removeAttachment(File file) {
    attachments.remove(file);
  }

  Future<pb.MediaUploadResponse?> uploadMedia(File file, {String? alt}) async {
    try {
      final form = dio.FormData.fromMap({
        'file': await dio.MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
        if (alt != null) 'alt': alt,
      });
      final resp = await _api.post<Map<String, dynamic>>('/activitypub/$_actor/media', data: form);
      final data = resp.data ?? {};
      return pb.MediaUploadResponse(
        mediaId: data['data']?['media_id'] ?? data['data']?['mediaId'] ?? data['media_id'] ?? data['mediaId'] ?? '',
        url: data['data']?['url'] ?? data['url'] ?? '',
        mediaType: data['data']?['media_type'] ?? data['data']?['mediaType'] ?? data['media_type'] ?? data['mediaType'] ?? '',
        alt: alt ?? '',
      );
    } catch (e) {
      LoggingService.error('UploadMedia', e.toString());
      errorText.value = e.toString();
      return null;
    }
  }

  Future<pb.PostResponse?> submit() async {
    if (text.value.isEmpty && attachments.isEmpty) return null;
    
    try {
      submitting.value = true;
      errorText.value = null;

      // 1. Upload Attachments
      final uploadedMedia = <pb.MediaUploadResponse>[];
      for (var file in attachments) {
        final res = await uploadMedia(file);
        if (res != null) {
          uploadedMedia.add(res);
        }
      }

      // 2. Construct ActivityPub Activity
      final baseUrl = _api.dio.options.baseUrl.replaceAll(RegExp(r'/$'), '');
      final actorName = _actor;
      final actorId = '$baseUrl/activitypub/$actorName/actor';
      final followers = '$baseUrl/activitypub/$actorName/followers';
      const public = 'https://www.w3.org/ns/activitystreams#Public';

      final to = visibility.value == 'public' ? [public] : [followers];
      final cc = visibility.value == 'public' ? [followers] : [];

      final note = {
        'type': 'Note',
        'content': text.value,
        'attributedTo': actorId,
        'to': to,
        'cc': cc,
        'attachment': uploadedMedia.map((att) => {
          'type': 'Document',
          'mediaType': att.mediaType,
          'url': att.url,
          'name': att.alt,
        }).toList(),
      };

      if (cwEnabled.value && cw.value.isNotEmpty) {
        note['summary'] = cw.value;
        note['sensitive'] = true;
      }

      final activity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        'type': 'Create',
        'actor': actorId,
        'object': note,
        'to': to,
        'cc': cc,
      };

      // 3. Submit Post to Outbox
      final resp = await _api.post<Map<String, dynamic>>('/activitypub/$actorName/outbox', data: activity);
      final data = resp.data ?? {};
      
      submitting.value = false;
      
      // Clear form on success
      text.value = '';
      cw.value = '';
      cwEnabled.value = false;
      attachments.clear();
      Get.back(); // Close dialog

      return pb.PostResponse(
        postId: data['id'] ?? '', // ActivityPub returns 'id' (activity ID)
        activityId: data['id'] ?? '',
      );
    } catch (e) {
      submitting.value = false;
      LoggingService.error('CreatePost', e.toString());
      errorText.value = e.toString();
      return null;
    }
  }
}
