import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/repositories/actor_repository.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/models/actor_base.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
import 'package:peers_touch_desktop/core/services/file_cache_service.dart';
import 'package:peers_touch_desktop/core/models/upload_result.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/features/profile/model/user_detail.dart';

class ProfileController extends GetxController {
  final Rx<ActorBase?> user = Rx<ActorBase?>(null);
  final Rx<UserDetail?> detail = Rx<UserDetail?>(null);
  final RxBool following = false.obs;

  @override
  void onInit() {
    super.onInit();
    // Initialize with placeholder data to avoid empty UI
    user.value = ActorBase(id: '0', name: 'User', avatar: null);
    detail.value = const UserDetail(
      id: '0',
      displayName: 'User',
      handle: 'user',
      summary: '',
      region: '',
      timezone: '',
      tags: [],
      links: [],
      followersCount: 0,
      followingCount: 0,
      showCounts: false,
      moments: [],
      defaultVisibility: 'public',
      manuallyApprovesFollowers: true,
      messagePermission: 'mutual',
      actorUrl: '',
      serverDomain: '',
      keyFingerprint: '',
      verifications: [],
      peersTouch: PeersTouchInfo(networkId: ''),
    );

    // Fetch real data
    fetchProfile();
  }

  Future<void> fetchProfile() async {
    try {
      final auth = Get.find<AuthController>();
      // Try to determine username from auth controller inputs
      String username = auth.username.value;
      if (username.isEmpty && auth.email.value.isNotEmpty) {
        username = auth.email.value.split('@').first;
      }

      if (username.isEmpty) {
        // If username is still empty, we cannot fetch profile.
        // Should handle this case (e.g. redirect to login or show error)
        return;
      }

      Map<String, dynamic>? data;
      if (Get.isRegistered<ActorRepository>()) {
        final repo = Get.find<ActorRepository>();
        data = await repo.fetchProfile(username: username);
      } else {
        final client = HttpServiceLocator().httpService;
        try {
          final response = await client.getResponse<dynamic>(
            '/activitypub/$username/profile',
          );
          if (response.statusCode == 200 && response.data is Map) {
            data = (response.data as Map).cast<String, dynamic>();
          }
        } catch (_) {}
      }
      if (data != null) {
        detail.value = UserDetail.fromJson(data);
      }
    } catch (e) {
      // Log error
      print('Failed to fetch profile: $e');
    }
  }

  void toggleFollowing() => following.value = !following.value;

  void setDefaultVisibility(String v) {
    final d = detail.value;
    if (d != null) {
      detail.value = UserDetail(
        id: d.id,
        displayName: d.displayName,
        handle: d.handle,
        summary: d.summary,
        avatarUrl: d.avatarUrl,
        coverUrl: d.coverUrl,
        region: d.region,
        timezone: d.timezone,
        tags: d.tags,
        links: d.links,
        actorUrl: d.actorUrl,
        serverDomain: d.serverDomain,
        keyFingerprint: d.keyFingerprint,
        verifications: d.verifications,
        followersCount: d.followersCount,
        followingCount: d.followingCount,
        showCounts: d.showCounts,
        moments: d.moments,
        defaultVisibility: v,
        manuallyApprovesFollowers: d.manuallyApprovesFollowers,
        messagePermission: d.messagePermission,
        autoExpireDays: d.autoExpireDays,
      );
    }
  }

  void setManuallyApprovesFollowers(bool value) {
    final d = detail.value;
    if (d != null) {
      detail.value = UserDetail(
        id: d.id,
        displayName: d.displayName,
        handle: d.handle,
        summary: d.summary,
        avatarUrl: d.avatarUrl,
        coverUrl: d.coverUrl,
        region: d.region,
        timezone: d.timezone,
        tags: d.tags,
        links: d.links,
        actorUrl: d.actorUrl,
        serverDomain: d.serverDomain,
        keyFingerprint: d.keyFingerprint,
        verifications: d.verifications,
        followersCount: d.followersCount,
        followingCount: d.followingCount,
        showCounts: d.showCounts,
        moments: d.moments,
        defaultVisibility: d.defaultVisibility,
        manuallyApprovesFollowers: value,
        messagePermission: d.messagePermission,
        autoExpireDays: d.autoExpireDays,
      );
    }
  }

  void setMessagePermission(String value) {
    final d = detail.value;
    if (d != null) {
      detail.value = UserDetail(
        id: d.id,
        displayName: d.displayName,
        handle: d.handle,
        summary: d.summary,
        avatarUrl: d.avatarUrl,
        coverUrl: d.coverUrl,
        region: d.region,
        timezone: d.timezone,
        tags: d.tags,
        links: d.links,
        actorUrl: d.actorUrl,
        serverDomain: d.serverDomain,
        keyFingerprint: d.keyFingerprint,
        verifications: d.verifications,
        followersCount: d.followersCount,
        followingCount: d.followingCount,
        showCounts: d.showCounts,
        moments: d.moments,
        defaultVisibility: d.defaultVisibility,
        manuallyApprovesFollowers: d.manuallyApprovesFollowers,
        messagePermission: value,
        autoExpireDays: d.autoExpireDays,
      );
    }
  }

  Future<void> logout() async {
    try {
      if (Get.isRegistered<AuthController>()) {
        await Get.find<AuthController>().logout();
      } else {
        // Fallback if AuthController is somehow not registered (unlikely)
        try {
          if (Get.isRegistered<GlobalContext>()) {
            final gc = Get.find<GlobalContext>();
            await gc.setSession(null);
          }
        } catch (_) {}
        await LocalStorage().remove('auth_token');
        await LocalStorage().remove('refresh_token');
        await LocalStorage().remove('auth_token_type');
        Get.offAllNamed('/login');
      }
    } catch (_) {
      Get.offAllNamed('/login');
    }
  }

  Future<UploadResult?> uploadImage({required String category}) async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.image,
        allowMultiple: false,
      );

      if (result != null && result.files.single.path != null) {
        final file = File(result.files.single.path!);
        final oss = Get.find<OssService>();
        final meta = await oss.uploadFile(file);
        final url = meta['url']?.toString() ?? '';
        final key = meta['key']?.toString() ?? '';

        if (url.isNotEmpty) {
          final username = detail.value?.handle ?? 'user';
          final cache = FileCacheService();
          final local = await cache.downloadToUserDir(
            username: username,
            category: category,
            urlPath: url,
            suggestedName: key.isNotEmpty ? key.split('/').last : null,
          );
          return UploadResult(remoteUrl: url, localPath: local.path);
        }
      }
    } catch (e) {
      print('Upload failed: $e');
    }
    return null;
  }

  Future<void> updateProfile(Map<String, dynamic> updates) async {
    try {
      final client = HttpServiceLocator().httpService;
      final payload = <String, dynamic>{};
      // Normalize keys to protobuf json field names
      // Accept both camelCase and snake_case inputs
      void putIfPresent(String key, String altKey) {
        final v = updates.containsKey(key) ? updates[key] : updates[altKey];
        if (v != null) payload[altKey] = v;
      }

      putIfPresent('displayName', 'display_name');
      putIfPresent('note', 'note');
      putIfPresent('avatar', 'avatar');
      putIfPresent('header', 'header');
      putIfPresent('region', 'region');
      putIfPresent('timezone', 'timezone');
      putIfPresent('defaultVisibility', 'default_visibility');
      putIfPresent('manuallyApprovesFollowers', 'manually_approves_followers');
      putIfPresent('messagePermission', 'message_permission');
      putIfPresent('autoExpireDays', 'auto_expire_days');

      if (updates['tags'] is List) payload['tags'] = updates['tags'];
      if (updates['links'] is List) payload['links'] = updates['links'];

      await client.post('/activitypub/profile', data: payload);

      await fetchProfile();
      Get.back(); // Close dialog

      Get.snackbar(
        'Success',
        'Profile updated successfully',
        snackPosition: SnackPosition.BOTTOM,
        margin: const EdgeInsets.all(16),
      );
    } catch (e) {
      print('Update failed: $e');
      Get.snackbar(
        'Error',
        'Failed to update profile: $e',
        backgroundColor: Get.theme.colorScheme.errorContainer,
        colorText: Get.theme.colorScheme.onErrorContainer,
        snackPosition: SnackPosition.BOTTOM,
        margin: const EdgeInsets.all(16),
      );
    }
  }
}
