import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/profile/controller/profile_controller.dart';
import 'package:peers_touch_base/model/domain/actor/actor.pb.dart';

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
    final url = await _controller.uploadImage();
    if (url != null) {
      setState(() {
        _avatarUrl = url;
      });
    }
  }

  Future<void> _pickHeader() async {
    final url = await _controller.uploadImage();
    if (url != null) {
      setState(() {
        _headerUrl = url;
      });
    }
  }

  void _save() {
    if (_formKey.currentState!.validate()) {
      final request = UpdateProfileRequest();
      request.displayName = _displayNameController.text;
      request.note = _summaryController.text;
      request.region = _regionController.text;
      request.timezone = _timezoneController.text;
      
      if (_avatarUrl != null) request.avatar = _avatarUrl!;
      if (_headerUrl != null) request.header = _headerUrl!;
      
      _controller.updateProfile(request);
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
                            onTap: _pickHeader,
                            child: Container(
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surfaceVariant,
                                borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
                                image: _headerUrl != null
                                    ? DecorationImage(
                                        image: NetworkImage(_headerUrl!),
                                        fit: BoxFit.cover,
                                      )
                                    : null,
                              ),
                              child: Center(
                                child: Container(
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
                        // Avatar
                        Positioned(
                          left: 20,
                          bottom: 0,
                          child: GestureDetector(
                            onTap: _pickAvatar,
                            child: Container(
                              width: 80,
                              height: 80,
                              decoration: BoxDecoration(
                                color: theme.colorScheme.surface,
                                shape: BoxShape.circle,
                                border: Border.all(color: theme.colorScheme.surface, width: 4),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withOpacity(0.1),
                                    blurRadius: 8,
                                  )
                                ],
                              ),
                              child: ClipOval(
                                child: Stack(
                                  children: [
                                    if (_avatarUrl != null)
                                      Positioned.fill(
                                        child: Image.network(_avatarUrl!, fit: BoxFit.cover),
                                      )
                                    else
                                      const Center(child: Icon(Icons.person, size: 40)),
                                      
                                    Positioned.fill(
                                      child: Container(
                                        color: Colors.black38,
                                        child: const Icon(Icons.camera_alt, color: Colors.white, size: 24),
                                      ),
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
                      TextButton(
                        onPressed: () => Get.back(),
                        child: const Text('取消'),
                      ),
                      SizedBox(width: UIKit.spaceMd(context)),
                      FilledButton(
                        onPressed: _save,
                        child: const Text('保存'),
                      ),
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
