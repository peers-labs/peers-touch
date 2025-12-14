import 'dart:io';

import 'package:get/get.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/post/post.pb.dart' as pb;
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';
import 'package:peers_touch_base/context/global_context.dart';

class PostingController extends GetxController {
  final DiscoveryRepository _repo = Get.find<DiscoveryRepository>();
  final GlobalContext _gctx = Get.find<GlobalContext>();
  // ignore: unused_field
  final AuthController _auth = Get.find<AuthController>();
  
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
    // Try to get from AuthController first
    String name = _auth.username.value;
    
    // If username is empty but email exists, try to use email part
    if (name.isEmpty && _auth.email.value.isNotEmpty) {
       name = _auth.email.value.split('@').first;
    }

    // If still empty, try GlobalContext
    if (name.isEmpty) {
       final handle = _gctx.actorHandle ?? _gctx.currentSession?['username']?.toString();
       name = handle ?? '';
    }
    
    // Check override
    if (overrideActor != null && overrideActor!.isNotEmpty) {
      name = overrideActor!;
    }
    
    return name.trim().isEmpty ? 'dev' : name.trim();
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
      final data = await _repo.uploadMedia(_actor, file, alt: alt);
      final responseData = data['data'] ?? data; // Handle wrapper if any
      return pb.MediaUploadResponse(
        mediaId: responseData['media_id'] ?? responseData['mediaId'] ?? '',
        url: responseData['url'] ?? '',
        mediaType: responseData['media_type'] ?? responseData['mediaType'] ?? '',
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
      final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
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
      final data = await _repo.submitPost(actorName, activity);
      
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
