import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/repositories/actor_repository.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/models/actor_base.dart';
import 'package:peers_touch_desktop/core/models/upload_result.dart';
import 'package:peers_touch_desktop/core/services/file_cache_service.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/features/profile/model/user_detail.dart';

class ProfileController extends GetxController {
  final Rx<ActorBase?> user = Rx<ActorBase?>(null);
  final Rx<UserDetail?> detail = Rx<UserDetail?>(null);
  final RxBool following = false.obs;
  final RxBool uploadingAvatar = false.obs;
  final RxBool uploadingHeader = false.obs;
  final RxBool updatingProfile = false.obs;

  @override
  void onInit() {
    super.onInit();
    
    // 1. Initial sync
    _syncWithSession();

    // 2. Listen for session changes (Root Cause: React to login/logout/switch)
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      gc.onSessionChange.listen((session) {
        _syncWithSession();
        fetchProfile();
      });
    }
    
    // 3. Listen for auth controller state (for immediate feedback during login)
    if (Get.isRegistered<AuthController>()) {
      final auth = Get.find<AuthController>();
      ever(auth.username, (_) => _onAuthChanged());
    }

    // 4. Initial fetch
    fetchProfile();
  }

  void _onAuthChanged() {
    _syncWithSession();
    fetchProfile();
  }

  void _syncWithSession() {
    String? handle;
    String? name;

    // 1. Try GlobalContext first (Source of Truth)
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      handle = gc.actorHandle;
    }

    // 2. Fallback to AuthController (Active input/restored state)
    if ((handle == null || handle.isEmpty) && Get.isRegistered<AuthController>()) {
      final auth = Get.find<AuthController>();
      handle = auth.username.value;
      if (handle.isEmpty && auth.email.value.isNotEmpty) {
        handle = auth.email.value.split('@').first;
      }
      name = auth.displayName.value;
    }

    if (handle == null || handle.isEmpty) {
      // If GlobalContext hasn't loaded yet, don't reset state immediately.
      // The onSessionChange listener will trigger another sync when hydration completes.
      if (Get.isRegistered<GlobalContext>()) {
        final gc = Get.find<GlobalContext>();
        if (gc.currentSession == null) {
          // If session is explicitly null, then we are not logged in.
          _resetState();
        }
      } else {
        _resetState();
      }
      return;
    }

    name ??= handle;

    // Update state
    user.value = ActorBase(id: '0', name: name, avatar: null);
    
    // Update UserDetail if handle changed or it was null
    if (detail.value == null || detail.value!.id == '0' || detail.value!.handle != handle) {
      detail.value = UserDetail(
        id: '0',
        displayName: name,
        handle: handle,
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
        peersTouch: const PeersTouchInfo(networkId: ''),
      );
    }
  }

  void _resetState() {
    user.value = null;
    detail.value = null;
  }

  Future<void> fetchProfile() async {
    try {
      final auth = Get.find<AuthController>();
      // Try to determine username from auth controller inputs
      String username = auth.username.value;
      
      // 1. Try from AuthController email
      if (username.isEmpty && auth.email.value.isNotEmpty) {
        username = auth.email.value.split('@').first;
      }

      // 2. Try from GlobalContext (Session)
      if (username.isEmpty && Get.isRegistered<GlobalContext>()) {
        final gc = Get.find<GlobalContext>();
        username = gc.actorHandle ?? '';
      }
      
      if (username.isEmpty) {
        // If username is still empty but we are supposed to be logged in (ProfileController is active),
        // it means the session is invalid or incomplete.
        // Check if we have a token
        final hasToken = await LocalStorage().get<String>('auth_token') != null;
        if (hasToken) {
           // We have a token but no user info. 
           // We could try to fetch "whoami" here if API supported it.
           // For now, let's trigger a logout if we really can't identify the user, 
           // OR just return and let the UI stay empty (but user complained about this).
           // Let's try to logout to force re-login which fixes the state.
           LoggingService.warning('Critical: Logged in but no username found. Retrying in 1s...');
           await Future.delayed(const Duration(seconds: 1));
           _syncWithSession();
           // logout(); // Temporarily disable auto-logout to debug "No user" issue
        }
        return;
      }
      
      Map<String, dynamic>? data;
      if (Get.isRegistered<ActorRepository>()) {
        final repo = Get.find<ActorRepository>();
        try {
          data = await repo.fetchProfile(username: username);
          LoggingService.info('Profile data from repo for $username: $data');
        } catch (e) {
          // If repo throws error (it might not, depending on impl, but let's be safe)
          final errStr = e.toString();
          if (errStr.contains('401') || errStr.contains('403') || errStr.contains('404')) {
             LoggingService.warning('Auth error or user not found during profile fetch: $e. Logging out.');
             logout();
             return;
          }
        }
      } else {
        final client = HttpServiceLocator().httpService;
        try {
          final response = await client.getResponse<dynamic>(
            '/activitypub/$username/profile',
          );
          if (response.statusCode == 200 && response.data is Map) {
            data = (response.data as Map).cast<String, dynamic>();
            LoggingService.info('Profile data from http for $username: $data');
          }
        } catch (e) {
           // Handle specific errors
           if (e.toString().contains('401') || e.toString().contains('403')) {
             logout();
             return;
           }
           if (e.toString().contains('404')) {
             // User does not exist
             logout();
             return;
           }
        }
      }
      if (data != null) {
        detail.value = UserDetail.fromJson(data);
      }
    } catch (e) {
      LoggingService.error('Failed to fetch profile: $e');
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
        final path = result.files.single.path!;
        final file = File(path);
        return await uploadFile(file, category: category);
      }
    } catch (e) {
      LoggingService.error('Pick file failed: $e');
    }
    return null;
  }

  Future<UploadResult?> uploadFile(File file, {required String category}) async {
    final isLoading = category == 'avatar' ? uploadingAvatar : uploadingHeader;
    try {
      // 1. Validate file size (WeChat style limits)
      final bytes = await file.length();
      final mb = bytes / (1024 * 1024);
      final maxMb = category == 'avatar' ? 5.0 : 10.0;
      
      if (mb > maxMb) {
        Get.snackbar(
          '文件过大',
          '${category == 'avatar' ? '头像' : '背景图'}大小不能超过 ${maxMb.toInt()}MB',
          backgroundColor: Get.theme.colorScheme.errorContainer,
          colorText: Get.theme.colorScheme.onErrorContainer,
          snackPosition: SnackPosition.BOTTOM,
          margin: const EdgeInsets.all(16),
        );
        return null;
      }

      isLoading.value = true;
      final oss = Get.find<OssService>();
      final meta = await oss.uploadFile(file);
      var url = meta['url']?.toString() ?? '';
      final key = meta['key']?.toString() ?? '';

      if (url.isNotEmpty) {
        // Fix backslashes and relative path
        url = url.replaceAll('\\', '/');
        if (url.startsWith('/')) {
           final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
           url = '$baseUrl$url';
        }

        String? localPath;
        try {
          final username = detail.value?.handle ?? 'user';
          final cache = FileCacheService();
          // Use saveLocalFileToUserDir to avoid downloading what we already have
          final local = await cache.saveLocalFileToUserDir(
            username: username,
            category: category,
            urlPath: url,
            sourceFile: file,
            suggestedName: key.isNotEmpty ? key.replaceAll('\\', '/').split('/').last : null,
          );
          localPath = local.path;
        } catch (e) {
          LoggingService.warning('Save to cache failed: $e');
        }
        return UploadResult(remoteUrl: url, localPath: localPath);
      }
    } catch (e) {
      LoggingService.error('Upload failed: $e');
      String message = '上传失败，请检查网络连接';
      if (e.toString().contains('Connection refused') || e.toString().contains('SocketException')) {
        message = '无法连接到服务器，请确保服务端已启动 (Connection Refused)';
      }
      
      Get.snackbar(
        '上传错误',
        message,
        backgroundColor: Get.theme.colorScheme.errorContainer,
        colorText: Get.theme.colorScheme.onErrorContainer,
        snackPosition: SnackPosition.BOTTOM,
        margin: const EdgeInsets.all(16),
        duration: const Duration(seconds: 5),
      );
    } finally {
      isLoading.value = false;
    }
    return null;
  }

  Future<void> updateProfile(Map<String, dynamic> updates) async {
    try {
      updatingProfile.value = true;
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
      LoggingService.error('Update failed: $e');
      Get.snackbar(
        'Error',
        'Failed to update profile: $e',
        backgroundColor: Get.theme.colorScheme.errorContainer,
        colorText: Get.theme.colorScheme.onErrorContainer,
        snackPosition: SnackPosition.BOTTOM,
        margin: const EdgeInsets.all(16),
      );
    } finally {
      updatingProfile.value = false;
    }
  }
}
