import 'dart:io';

import 'package:get/get.dart';
import 'package:dio/dio.dart' as dio;
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/post/post.pb.dart' as pb;

class PostingController extends GetxController {
  final ApiClient _api = Get.find<ApiClient>();
  final actor = 'dev'.obs;
  final submitting = false.obs;
  final errorText = RxnString();

  void setActor(String name) => actor.value = name;

  Future<pb.MediaUploadResponse?> uploadMedia(File file, {String? alt}) async {
    try {
      final form = dio.FormData.fromMap({
        'file': await dio.MultipartFile.fromFile(file.path, filename: file.uri.pathSegments.last),
        if (alt != null) 'alt': alt,
      });
      final resp = await _api.post<Map<String, dynamic>>('/activitypub/${actor.value}/media', data: form);
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

  Future<pb.PostResponse?> submit(pb.PostInput input) async {
    try {
      submitting.value = true;
      final resp = await _api.post<Map<String, dynamic>>('/activitypub/${actor.value}/post', data: input.toProto3Json());
      final data = resp.data ?? {};
      submitting.value = false;
      return pb.PostResponse(
        postId: data['data']?['post_id'] ?? data['data']?['postId'] ?? data['post_id'] ?? data['postId'] ?? '',
        activityId: data['data']?['activity_id'] ?? data['data']?['activityId'] ?? data['activity_id'] ?? data['activityId'] ?? '',
      );
    } catch (e) {
      submitting.value = false;
      LoggingService.error('CreatePost', e.toString());
      errorText.value = e.toString();
      return null;
    }
  }
}
