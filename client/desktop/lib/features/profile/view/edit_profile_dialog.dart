import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/core/utils/image_utils.dart';
import 'package:peers_touch_desktop/core/widgets/image_cropper_dialog.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';

class EditProfileDialog extends StatefulWidget {
  const EditProfileDialog({super.key});

  @override
  State<EditProfileDialog> createState() => _EditProfileDialogState();
}

class _EditProfileDialogState extends State<EditProfileDialog> {
  final _formKey = GlobalKey<FormState>();
  final _controller = Get.find<ProfileController>();
  
  late TextEditingController _displayNameController;
  late TextEditingController _summaryController;
  late TextEditingController _regionController;
  late TextEditingController _timezoneController;
  
  String? _avatarUrl;
  String? _headerUrl;
  String? _avatarLocalPath;
  String? _headerLocalPath;

  @override
  void initState() {
    super.initState();
    final d = _controller.detail.value;
    _displayNameController = TextEditingController(text: d?.displayName ?? '');
    _summaryController = TextEditingController(text: d?.summary ?? '');
    _regionController = TextEditingController(text: d?.region ?? '');
    _timezoneController = TextEditingController(text: d?.timezone ?? '');
    
    _avatarUrl = d?.avatarUrl;
    _headerUrl = d?.coverUrl;
  }

  @override
  void dispose() {
    _displayNameController.dispose();
    _summaryController.dispose();
    _regionController.dispose();
    _timezoneController.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar() async {
    // 1. Pick Image
    final result = await FilePicker.platform.pickFiles(
      type: FileType.image,
      allowMultiple: false,
    );
    
    if (result == null || result.files.single.path == null) return;
    
    final originalFile = File(result.files.single.path!);

    // 2. Crop Image
    final Uint8List? croppedBytes = await Get.dialog(
      ImageCropperDialog(
        imageFile: originalFile,
        isCircular: true,
      ),
      useSafeArea: false,
    );

    if (croppedBytes == null) return;

    // 3. Save to Temp File
    final tempDir = await getTemporaryDirectory();
    final ext = p.extension(originalFile.path);
    final tempFile = File(p.join(tempDir.path, 'avatar_crop_${DateTime.now().millisecondsSinceEpoch}$ext'));
    await tempFile.writeAsBytes(croppedBytes);

    // 4. Upload
    final res = await _controller.uploadFile(tempFile, category: 'avatar');
    if (res != null) {
      setState(() {
        _avatarUrl = res.remoteUrl;
        _avatarLocalPath = res.localPath;
      });
    }
  }

  Future<void> _pickHeader() async {
    final res = await _controller.uploadImage(category: 'header');
    if (res != null) {
      setState(() {
        _headerUrl = res.remoteUrl;
        _headerLocalPath = res.localPath;
      });
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    
    final updates = <String, dynamic>{
      'display_name': _displayNameController.text,
      'note': _summaryController.text,
      'region': _regionController.text,
      'timezone': _timezoneController.text,
    };
    
    if (_avatarUrl != null && _avatarUrl!.trim().isNotEmpty) {
      updates['avatar'] = _avatarUrl;
    }
    if (_headerUrl != null && _headerUrl!.trim().isNotEmpty) {
      updates['header'] = _headerUrl;
    }
    
    try {
      await _controller.updateProfile(updates);
      if (mounted) {
        Get.back();
        Get.snackbar(
          '成功',
          '个人资料已更新',
          snackPosition: SnackPosition.TOP,
          duration: const Duration(seconds: 2),
          backgroundColor: Colors.green,
          colorText: Colors.white,
        );
      }
    } catch (e) {
      if (mounted) {
        Get.snackbar(
          '失败',
          '更新失败: $e',
          snackPosition: SnackPosition.TOP,
          duration: const Duration(seconds: 3),
          backgroundColor: Colors.red,
          colorText: Colors.white,
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500),
        child: SingleChildScrollView(
          child: Padding(
            padding: EdgeInsets.all(UIKit.spaceLg(context)),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('编辑个人资料', style: theme.textTheme.headlineSmall),
                  SizedBox(height: UIKit.spaceLg(context)),
                  
                  // Header & Avatar
                  SizedBox(
                    height: 200,
                    child: Stack(
                      children: [
                        // Header
                        Positioned.fill(
                          bottom: 40,
                          child: GestureDetector(
                            onTap: () {
                              if (!_controller.uploadingHeader.value && !_controller.updatingProfile.value) {
                                _pickHeader();
                              }
                            },
                            child: Container(
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceContainerHighest,
                                borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
                                image: (() {
                                  final p = imageProviderFor(_headerLocalPath ?? _headerUrl);
                                  if (p == null) return null;
                                  return DecorationImage(image: p, fit: BoxFit.cover);
                                })(),
                              ),
                              child: Center(
                                child: Obx(() => _controller.uploadingHeader.value 
                                  ? const CircularProgressIndicator(color: Colors.white)
                                  : Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        color: Colors.black54,
                                        borderRadius: BorderRadius.circular(20),
                                      ),
                                      child: const Text(
                                        '点击修改 Header (背景图)', 
                                        style: TextStyle(color: Colors.white),
                                      ),
                                    ),
                                ),
                              ),
                            ),
                          ),
                        ),
                        // Avatar
                        Positioned(
                          left: 20,
                          bottom: 0,
                          child: GestureDetector(
                            onTap: () {
                              if (!_controller.uploadingAvatar.value && !_controller.updatingProfile.value) {
                                _pickAvatar();
                              }
                            },
                            child: Container(
                              width: 80,
                              height: 80,
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surface,
                                shape: BoxShape.circle,
                                border: Border.all(color: theme.colorScheme.surface, width: 4),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.1),
                                    blurRadius: 8,
                                  )
                                ],
                              ),
                              child: ClipOval(
                                child: Stack(
                                  children: [
                                    (() {
                                      final p = imageProviderFor(_avatarLocalPath ?? _avatarUrl);
                                      if (p != null) {
                                        return Positioned.fill(child: Image(image: p, fit: BoxFit.cover));
                                      }
                                      return const Center(child: Icon(Icons.person, size: 40));
                                    })(),
                                      
                                    Positioned.fill(
                                      child: Obx(() => Container(
                                        color: Colors.black38,
                                        child: _controller.uploadingAvatar.value 
                                          ? const Padding(
                                              padding: EdgeInsets.all(24.0),
                                              child: CircularProgressIndicator(strokeWidth: 3, color: Colors.white),
                                            )
                                          : const Icon(Icons.camera_alt, color: Colors.white, size: 24),
                                      )),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: UIKit.spaceMd(context)),
                  Text(
                    'Header 是个人主页的背景图，Icon (Avatar) 是代表你的头像。',
                    style: theme.textTheme.bodySmall?.copyWith(color: UIKit.textSecondary(context)),
                  ),
                  SizedBox(height: UIKit.spaceLg(context)),
                  
                  TextFormField(
                    controller: _displayNameController,
                    decoration: const InputDecoration(
                      labelText: '昵称',
                      hintText: 'Display Name',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  SizedBox(height: UIKit.spaceMd(context)),
                  
                  TextFormField(
                    controller: _summaryController,
                    decoration: const InputDecoration(
                      labelText: '简介',
                      hintText: 'Bio',
                      border: OutlineInputBorder(),
                    ),
                    maxLines: 3,
                  ),
                  SizedBox(height: UIKit.spaceMd(context)),
                  
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _regionController,
                          decoration: const InputDecoration(
                            labelText: '地区',
                            hintText: 'Region',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                      SizedBox(width: UIKit.spaceMd(context)),
                      Expanded(
                        child: TextFormField(
                          controller: _timezoneController,
                          decoration: const InputDecoration(
                            labelText: '时区',
                            hintText: 'Timezone',
                            border: OutlineInputBorder(),
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: UIKit.spaceLg(context)),
                  
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Obx(() => TextButton(
                        onPressed: (_controller.updatingProfile.value || _controller.uploadingAvatar.value || _controller.uploadingHeader.value) 
                          ? null 
                          : () => Get.back(),
                        child: const Text('取消'),
                      )),
                      SizedBox(width: UIKit.spaceMd(context)),
                      Obx(() => FilledButton(
                        onPressed: (_controller.updatingProfile.value || _controller.uploadingAvatar.value || _controller.uploadingHeader.value)
                          ? null
                          : _save,
                        child: _controller.updatingProfile.value
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('保存'),
                      )),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
