import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:get/get.dart' hide Response, FormData, MultipartFile;
import 'package:dio/dio.dart';
import 'package:peers_touch_base/model/domain/actor/actor.pb.dart';
import 'package:peers_touch_desktop/core/models/actor_base.dart';
import 'package:peers_touch_desktop/features/profile/model/user_detail.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/utils/toast.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/repositories/actor_repository.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';

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
          final response = await client.getResponse<dynamic>('/activitypub/$username/profile');
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
      try {
        if (Get.isRegistered<GlobalContext>()) {
          final gc = Get.find<GlobalContext>();
          await gc.setSession(null);
        }
      } catch (_) {}
      await LocalStorage().remove('auth_token');
      await LocalStorage().remove('refresh_token');
      await LocalStorage().remove('auth_token_type');
    } catch (_) {}
    Get.offAllNamed('/login');
  }

  Future<String?> uploadImage() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.image,
        allowMultiple: false,
      );

      if (result != null && result.files.single.path != null) {
        final file = File(result.files.single.path!);
        
        final ossService = Get.find<OssService>();
        final response = await ossService.uploadFile(file);
        
        // OssService.uploadFile returns Map<String, dynamic>
        // and ossFile.toJson() returns keys like 'url', 'key', etc.
        if (response.containsKey('url') && response['url'] != null) {
          String url = response['url'] as String;
          if (url.startsWith('/')) {
            final baseUrl = HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
            url = '$baseUrl$url';
          }
          Toast.showSuccess('Image uploaded successfully');
          return url;
        }
      }
    } catch (e) {
      print('Upload failed: $e');
      if (e is DioException) {
         Toast.showError('Upload failed: ${e.response?.data ?? e.message}');
      } else if (e is TypeError) {
         Toast.showError('Upload failed: Response format error');
      } else {
         Toast.showError('Upload failed: $e');
      }
    }
    return null;
  }

  Future<void> updateProfile(UpdateProfileRequest request) async {
    try {
      final client = HttpServiceLocator().httpService;
      print('Updating profile with: ${request.toProto3Json()}');
      
      // Endpoint: /activitypub/profile
      await client.post('/activitypub/profile', data: request.toProto3Json());
      
      await fetchProfile();
      Get.back(); // Close dialog
      
      Toast.showSuccess('Profile updated successfully');
    } catch (e) {
      print('Update failed: $e');
      String errorMessage = 'Failed to update profile';
      if (e is DioException) {
        errorMessage += ': ${e.response?.data ?? e.message}';
        print('Server response: ${e.response?.data}');
      } else {
        errorMessage += ': $e';
      }
      Toast.showError(errorMessage);
    }
  }
}
