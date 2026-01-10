import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:path_provider/path_provider.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_desktop/core/models/upload_result.dart';
import 'package:peers_touch_desktop/core/widgets/image_cropper_dialog.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';

class EditProfileDialogController extends GetxController {
  final formKey = GlobalKey<FormState>();
  final profileController = Get.find<ProfileController>();
  
  late final TextEditingController displayNameController;
  late final TextEditingController summaryController;
  late final TextEditingController regionController;
  late final TextEditingController timezoneController;
  
  final Rx<String?> avatarUrl = Rx<String?>(null);
  final Rx<String?> headerUrl = Rx<String?>(null);

  @override
  void onInit() {
    super.onInit();
    final d = profileController.detail.value;
    displayNameController = TextEditingController(text: d?.displayName ?? '');
    summaryController = TextEditingController(text: d?.summary ?? '');
    regionController = TextEditingController(text: d?.region ?? '');
    timezoneController = TextEditingController(text: d?.timezone ?? '');
    
    avatarUrl.value = d?.avatarUrl;
    headerUrl.value = d?.coverUrl;
  }

  @override
  void onClose() {
    displayNameController.dispose();
    summaryController.dispose();
    regionController.dispose();
    timezoneController.dispose();
    super.onClose();
  }

  bool get isBusy => 
    profileController.uploadingAvatar.value || 
    profileController.uploadingHeader.value || 
    profileController.updatingProfile.value;

  bool _isImageUpload(UploadResult r) {
    final m = (r.mime ?? '').trim().toLowerCase();
    if (m.isNotEmpty) {
      return m.startsWith('image/');
    }
    final uri = Uri.tryParse(r.remoteUrl);
    final key = (r.key ?? '').trim().isNotEmpty ? r.key!.trim() : uri?.queryParameters['key'];
    final candidate = (key ?? uri?.path ?? '').toLowerCase();
    final dot = candidate.lastIndexOf('.');
    if (dot < 0 || dot == candidate.length - 1) return false;
    final ext = candidate.substring(dot + 1);
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

  Future<void> pickAvatar() async {
    if (isBusy) return;
    
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    
    if (result == null || result.files.single.path == null) return;
    
    final originalFile = File(result.files.single.path!);

    final Uint8List? croppedBytes = await Get.dialog(
      ImageCropperDialog(
        imageFile: originalFile,
        isCircular: true,
      ),
      useSafeArea: false,
    );

    if (croppedBytes == null) return;

    final tempDir = await getTemporaryDirectory();
    final dot = originalFile.path.lastIndexOf('.');
    final ext = dot >= 0 ? originalFile.path.substring(dot) : '';
    final tempFile = File('${tempDir.path}/avatar_crop_${DateTime.now().millisecondsSinceEpoch}$ext');
    await tempFile.writeAsBytes(croppedBytes);

    profileController.uploadingAvatar.value = true;
    try {
      final res = await profileController.uploadFile(tempFile, category: 'avatar');
      if (res != null && res.remoteUrl.isNotEmpty) {
        if (!_isImageUpload(res)) {
          Get.snackbar(
            '错误',
            '头像必须是图片文件',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.red,
            colorText: Colors.white,
          );
          return;
        }
        avatarUrl.value = res.remoteUrl;
        await profileController.updateProfile({'avatar': res.remoteUrl});
        Get.snackbar(
          '成功',
          '头像已更新',
          snackPosition: SnackPosition.BOTTOM,
        );
      }
    } catch (e) {
      LoggingService.error('Avatar upload failed: $e');
      Get.snackbar(
        '错误',
        '头像上传失败: $e',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red,
        colorText: Colors.white,
      );
    } finally {
      profileController.uploadingAvatar.value = false;
    }
  }

  Future<void> pickHeader() async {
    if (isBusy) return;
    
    profileController.uploadingHeader.value = true;
    try {
      final res = await profileController.uploadImage(category: 'header');
      if (res != null && res.remoteUrl.isNotEmpty) {
        if (!_isImageUpload(res)) {
          Get.snackbar(
            '错误',
            '背景图必须是图片文件',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.red,
            colorText: Colors.white,
          );
          return;
        }
        headerUrl.value = res.remoteUrl;
        await profileController.updateProfile({'header': res.remoteUrl});
        Get.snackbar(
          '成功',
          '背景图已更新',
          snackPosition: SnackPosition.BOTTOM,
        );
      }
    } catch (e) {
      LoggingService.error('Header upload failed: $e');
      Get.snackbar(
        '错误',
        '背景图上传失败: $e',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red,
        colorText: Colors.white,
      );
    } finally {
      profileController.uploadingHeader.value = false;
    }
  }

  Future<bool> save() async {
    if (!formKey.currentState!.validate() || isBusy) return false;
    
    final updates = <String, dynamic>{
      'display_name': displayNameController.text,
      'note': summaryController.text,
      'region': regionController.text,
      'timezone': timezoneController.text,
    };
    
    if (avatarUrl.value != null && avatarUrl.value!.trim().isNotEmpty) {
      updates['avatar'] = avatarUrl.value;
    }
    if (headerUrl.value != null && headerUrl.value!.trim().isNotEmpty) {
      updates['header'] = headerUrl.value;
    }
    
    try {
      await profileController.updateProfile(updates);
      Get.snackbar(
        '成功',
        '个人资料已更新',
        snackPosition: SnackPosition.BOTTOM,
      );
      return true;
    } catch (e) {
      LoggingService.error('Update profile failed: $e');
      Get.snackbar(
        '错误',
        '更新失败: $e',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red,
        colorText: Colors.white,
      );
      return false;
    }
  }
}
