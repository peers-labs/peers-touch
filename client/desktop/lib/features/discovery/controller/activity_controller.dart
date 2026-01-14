import 'dart:io';

import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/activity/activity.pb.dart' as pb;
import 'package:peers_touch_base/model/domain/social/post.pb.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';

class ActivityController extends GetxController {
  final DiscoveryRepository _repo = Get.find<DiscoveryRepository>();
  final OssService _ossService = Get.find<OssService>();
  
  String? overrideActor;
  
  final submitting = false.obs;
  final errorText = RxnString();

  // Form State
  final text = ''.obs;
  final cw = ''.obs;
  final cwEnabled = false.obs;
  final visibility = 'public'.obs;
  final attachments = <File>[].obs;
  
  // Keep state even when closed?
  // We want to keep state if user closes dialog without submitting.
  // But clear it on successful submit.
  
  // TODO: Add Poll state

  void setActor(String name) => overrideActor = name;

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
      final data = await _ossService.uploadFile(file);
      // OSS returns: { "key": "...", "url": "...", "mime": "..." }
      
      // We need to construct the full URL if it's relative
      String url = data['url']?.toString() ?? '';
      if (url.startsWith('/')) {
        final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
        url = '$baseUrl$url';
      }

      return pb.MediaUploadResponse(
        mediaId: data['key']?.toString() ?? '',
        url: url,
        mediaType: data['mime']?.toString() ?? 'application/octet-stream',
        alt: alt ?? '',
      );
    } catch (e) {
      LoggingService.error('UploadMedia', e.toString());
      errorText.value = e.toString();
      return null;
    }
  }

  Future<pb.ActivityResponse?> submit() async {
    if (text.value.isEmpty && attachments.isEmpty) return null;
    
    try {
      submitting.value = true;
      errorText.value = null;

      // 1. Upload Attachments
      final mediaUrls = <String>[];
      for (var file in attachments) {
        final res = await uploadMedia(file);
        if (res != null) {
          mediaUrls.add(res.url);
        }
      }

      // 2. Create post using new Social API
      final post = await _repo.createPost(
        text: text.value,
        mediaUrls: mediaUrls.isNotEmpty ? mediaUrls : null,
        visibility: visibility.value,
      );
      
      submitting.value = false;
      
      // Clear form on success
      text.value = '';
      cw.value = '';
      cwEnabled.value = false;
      attachments.clear();
      Get.back(); // Close dialog

      // OPTIMISTIC UPDATE: Add the new item to DiscoveryController immediately
      if (Get.isRegistered<DiscoveryController>()) {
        final discovery = Get.find<DiscoveryController>();
        
        final postText = _getPostText(post);
        final postImages = _getPostImages(post);
        
        final newItem = DiscoveryItem(
          id: post.id,
          objectId: post.id,
          title: postText.isNotEmpty ? postText : 'New Post',
          content: postText,
          author: post.author.username,
          authorId: post.author.id,
          authorAvatar: post.author.avatarUrl,
          timestamp: post.createdAt.toDateTime(),
          type: 'Create',
          images: postImages,
          likesCount: post.stats.likesCount.toInt(),
          commentsCount: post.stats.commentsCount.toInt(),
          sharesCount: post.stats.repostsCount.toInt(),
        );
        
        discovery.addNewItem(newItem);
      }

      return pb.ActivityResponse(
        postId: post.id,
        activityId: post.id,
      );
    } catch (e) {
      submitting.value = false;
      LoggingService.error('CreateActivity', e.toString());
      errorText.value = e.toString();
      return null;
    }
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
      case Post_Content.notSet:
        return '';
    }
  }

  List<String> _getPostImages(Post post) {
    switch (post.whichContent()) {
      case Post_Content.imagePost:
        return post.imagePost.images.map((img) => img.url).toList();
      case Post_Content.locationPost:
        return post.locationPost.images.map((img) => img.url).toList();
      default:
        return [];
    }
  }
}
