import 'dart:io';

import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/activity/activity.pb.dart' as pb;
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/model/discovery_item.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';

class ActivityController extends GetxController {
  final DiscoveryRepository _repo = Get.find<DiscoveryRepository>();
  final GlobalContext _gctx = Get.find<GlobalContext>();
  final OssService _ossService = Get.find<OssService>();
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
  
  // Keep state even when closed?
  // We want to keep state if user closes dialog without submitting.
  // But clear it on successful submit.
  
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
      final uploadedMedia = <pb.MediaUploadResponse>[];
      for (var file in attachments) {
        final res = await uploadMedia(file);
        if (res != null) {
          uploadedMedia.add(res);
        }
      }

      // 2. Construct ActivityInput (Proto)
      final actorName = _actor;
      final input = pb.ActivityInput(
        text: text.value,
        visibility: visibility.value,
        attachments: uploadedMedia.map((m) => pb.Attachment(
          mediaId: m.mediaId,
          url: m.url,
          mediaType: m.mediaType,
          alt: m.alt,
        )),
      );

      if (cwEnabled.value && cw.value.isNotEmpty) {
        input.cw = cw.value;
        input.sensitive = true;
      }

      // 3. Submit Activity to Outbox
      final data = await _repo.submitActivity(actorName, input);
      
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
        
        // Convert local data to DiscoveryItem
        final newItem = DiscoveryItem(
          id: data['id']?.toString() ?? DateTime.now().toString(),
          objectId: data['object']?['id']?.toString() ?? '', // Try to get object ID from response, or use activity ID fallback? Or empty.
          title: input.hasCw() && input.cw.isNotEmpty ? input.cw : (input.text.isNotEmpty ? input.text : 'New Post'), 
          content: input.text,
          author: actorName,
          authorAvatar: 'https://i.pravatar.cc/150?u=$actorName', // Ideally get from user profile
          timestamp: DateTime.now(),
          type: 'Create',
          images: uploadedMedia.map((e) => e.url).toList(), // Use uploadedMedia directly for URLs
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
        );
        
        discovery.addNewItem(newItem);
      }

      return pb.ActivityResponse(
        postId: data['id'] ?? '', // ActivityPub returns 'id' (activity ID)
        activityId: data['id'] ?? '',
      );
    } catch (e) {
      submitting.value = false;
      LoggingService.error('CreateActivity', e.toString());
      errorText.value = e.toString();
      return null;
    }
  }
}
