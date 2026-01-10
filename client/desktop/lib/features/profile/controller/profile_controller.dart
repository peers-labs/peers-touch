import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart' hide FormData, MultipartFile;
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/models/actor_base.dart';
import 'package:peers_touch_desktop/core/models/upload_result.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
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
    
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      
      _syncFromGlobalContext(gc.userProfile);
      
      gc.onProfileChange.listen((profile) {
        _syncFromGlobalContext(profile);
      });
    }
  }

  void _syncFromGlobalContext(Map<String, dynamic>? profile) {
    if (profile == null) {
      _resetState();
      return;
    }
    
    try {
      detail.value = UserDetail.fromJson(profile);
      user.value = ActorBase(
        id: profile['id']?.toString() ?? '0',
        name: profile['display_name']?.toString() ?? 
              profile['displayName']?.toString() ?? 
              profile['username']?.toString() ?? '',
        avatar: profile['avatar']?.toString() ?? 
                profile['avatarUrl']?.toString(),
      );
      LoggingService.info('ProfileController synced from GlobalContext');
    } catch (e) {
      LoggingService.warning('ProfileController sync failed: $e');
    }
  }

  void _resetState() {
    user.value = null;
    detail.value = null;
    following.value = false;
  }

  Future<void> refreshProfile() async {
    if (Get.isRegistered<GlobalContext>()) {
      await Get.find<GlobalContext>().refreshProfile();
    }
  }

  void logout() async {
    try {
      await LocalStorage().remove('auth_token');
      await LocalStorage().remove('username');
      await LocalStorage().remove('email');
      
      if (Get.isRegistered<GlobalContext>()) {
        final gc = Get.find<GlobalContext>();
        gc.clearProfile();
        await gc.setSession(null);
      }
      
      _resetState();
      Get.offAllNamed('/login');
    } catch (e) {
      LoggingService.error('Logout failed: $e');
    }
  }

  void toggleFollowing() => following.value = !following.value;

  void setDefaultVisibility(String v) {
    _updateField('default_visibility', v);
  }

  void setManuallyApprovesFollowers(bool value) {
    _updateField('manually_approves_followers', value);
  }

  void setMessagePermission(String value) {
    _updateField('message_permission', value);
  }

  Future<void> _updateField(String field, dynamic value) async {
    await _sendProfileUpdate({field: value});
  }

  Future<void> _sendProfileUpdate(Map<String, dynamic> data) async {
    if (data.isEmpty) return;
    
    try {
      final client = HttpServiceLocator().httpService;
      await client.postResponse<dynamic>(
        '/activitypub/profile',
        data: data,
      );
      await refreshProfile();
    } catch (e) {
      LoggingService.error('Profile update failed: $e');
    }
  }

  Future<UploadResult?> uploadFile(File file, {String? category}) async {
    try {
      final oss = Get.find<OssService>();
      final result = await oss.uploadFile(file);
      final remoteUrl = result['url']?.toString() ?? '';
      final mime = result['mime']?.toString();
      final key = result['key']?.toString();
      if (remoteUrl.isNotEmpty) {
        return UploadResult(remoteUrl: remoteUrl, localPath: null, mime: mime, key: key);
      }
    } catch (e) {
      LoggingService.error('Upload file failed: $e');
    }
    return null;
  }

  bool _isImageUrlOrKey(String? value) {
    final v = (value ?? '').trim();
    if (v.isEmpty) return false;

    String candidate = v;
    final uri = Uri.tryParse(v);
    if (uri != null) {
      final qpKey = uri.queryParameters['key'];
      if (qpKey != null && qpKey.trim().isNotEmpty) {
        candidate = qpKey.trim();
      } else {
        candidate = uri.path;
      }
    }

    final lower = candidate.toLowerCase();
    final dot = lower.lastIndexOf('.');
    if (dot < 0 || dot == lower.length - 1) return false;
    final ext = lower.substring(dot + 1);
    const exts = <String>{
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'bmp',
      'heic',
      'heif',
    };
    return exts.contains(ext);
  }

  bool _isImageUpload(UploadResult r) {
    final m = (r.mime ?? '').trim().toLowerCase();
    if (m.isNotEmpty) {
      return m.startsWith('image/');
    }
    return _isImageUrlOrKey(r.key) || _isImageUrlOrKey(r.remoteUrl);
  }

  Future<UploadResult?> uploadImage({String? category}) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return null;
    final path = result.files.first.path;
    if (path == null) return null;
    return uploadFile(File(path), category: category);
  }

  Future<void> uploadAvatar(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return;
    final path = result.files.first.path;
    if (path == null) return;

    uploadingAvatar.value = true;
    try {
      final file = File(path);
      final uploadResult = await uploadFile(file, category: 'avatar');
      if (uploadResult != null && uploadResult.remoteUrl.isNotEmpty) {
        if (!_isImageUpload(uploadResult)) {
          Get.snackbar(
            '错误',
            '头像必须是图片文件',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.red,
            colorText: Colors.white,
          );
          return;
        }
        await _sendProfileUpdate({'avatar': uploadResult.remoteUrl});
      }
    } catch (e) {
      LoggingService.error('Avatar upload failed: $e');
    } finally {
      uploadingAvatar.value = false;
    }
  }

  Future<void> uploadHeader(BuildContext context) async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return;
    final path = result.files.first.path;
    if (path == null) return;

    uploadingHeader.value = true;
    try {
      final file = File(path);
      final uploadResult = await uploadFile(file, category: 'header');
      if (uploadResult != null && uploadResult.remoteUrl.isNotEmpty) {
        if (!_isImageUpload(uploadResult)) {
          Get.snackbar(
            '错误',
            '背景图必须是图片文件',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.red,
            colorText: Colors.white,
          );
          return;
        }
        await _sendProfileUpdate({'header': uploadResult.remoteUrl});
      }
    } catch (e) {
      LoggingService.error('Header upload failed: $e');
    } finally {
      uploadingHeader.value = false;
    }
  }

  Future<void> updateProfile(Map<String, dynamic> updates) async {
    if (updates.isEmpty) return;

    updatingProfile.value = true;
    try {
      await _sendProfileUpdate(updates);
    } catch (e) {
      LoggingService.error('Update profile failed: $e');
      rethrow;
    } finally {
      updatingProfile.value = false;
    }
  }
}
