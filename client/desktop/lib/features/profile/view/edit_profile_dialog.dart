import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';
import 'package:peers_touch_desktop/features/profile/controller/edit_profile_controller.dart';
import 'package:peers_touch_ui/peers_touch_ui.dart';

class EditProfileDialog extends StatelessWidget {
  const EditProfileDialog({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(EditProfileDialogController());
    final theme = Theme.of(context);
    
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500),
        child: SingleChildScrollView(
          child: Padding(
            padding: EdgeInsets.all(UIKit.spaceLg(context)),
            child: Form(
              key: controller.formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('编辑个人资料', style: theme.textTheme.headlineSmall),
                  SizedBox(height: UIKit.spaceLg(context)),
                  
                  SizedBox(
                    height: 200,
                    child: Stack(
                      children: [
                        Positioned.fill(
                          bottom: 40,
                          child: GestureDetector(
                            onTap: controller.pickHeader,
                            child: Obx(() {
                              final url = controller.headerUrl.value ?? controller.profileController.detail.value?.coverUrl;
                              return ClipRRect(
                                borderRadius: BorderRadius.circular(UIKit.radiusMd(context)),
                                child: Stack(
                                  children: [
                                    Positioned.fill(
                                      child: Container(color: theme.colorScheme.surfaceContainerHighest),
                                    ),
                                    Positioned.fill(
                                      child: PeersImage(
                                        src: url,
                                        fit: BoxFit.cover,
                                      ),
                                    ),
                                    Center(
                                      child: controller.profileController.uploadingHeader.value
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
                                  ],
                                ),
                              );
                            }),
                          ),
                        ),
                        Positioned(
                          left: 20,
                          bottom: 0,
                          child: GestureDetector(
                            onTap: controller.pickAvatar,
                            child: Obx(() {
                              final url = controller.avatarUrl.value ?? controller.profileController.detail.value?.avatarUrl;
                              return Container(
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
                                      Positioned.fill(
                                        child: Container(color: theme.colorScheme.surfaceContainerHighest),
                                      ),
                                      Positioned.fill(
                                        child: PeersImage(
                                          src: url,
                                          fit: BoxFit.cover,
                                          error: const Center(child: Icon(Icons.person, size: 40)),
                                        ),
                                      ),
                                      Positioned.fill(
                                        child: Container(
                                          color: Colors.black38,
                                          child: controller.profileController.uploadingAvatar.value
                                              ? const Padding(
                                                  padding: EdgeInsets.all(24.0),
                                                  child: CircularProgressIndicator(strokeWidth: 3, color: Colors.white),
                                                )
                                              : const Icon(Icons.camera_alt, color: Colors.white, size: 24),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            }),
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
                    controller: controller.displayNameController,
                    decoration: const InputDecoration(
                      labelText: '昵称',
                      hintText: 'Display Name',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  SizedBox(height: UIKit.spaceMd(context)),
                  
                  TextFormField(
                    controller: controller.summaryController,
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
                          controller: controller.regionController,
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
                          controller: controller.timezoneController,
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
                        onPressed: controller.isBusy ? null : () => Get.back(),
                        child: const Text('取消'),
                      )),
                      SizedBox(width: UIKit.spaceMd(context)),
                      Obx(() => FilledButton(
                        onPressed: controller.isBusy ? null : controller.save,
                        child: controller.profileController.updatingProfile.value
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
