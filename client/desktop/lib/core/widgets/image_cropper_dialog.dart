import 'dart:io';

import 'package:extended_image/extended_image.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import 'image_cropper_controller.dart';

/// Image cropper dialog
/// StatelessWidget per project convention (ADR-002)
class ImageCropperDialog extends StatelessWidget {
  const ImageCropperDialog({
    super.key,
    required this.imageFile,
    this.isCircular = true,
  });
  
  final File imageFile;
  final bool isCircular;

  @override
  Widget build(BuildContext context) {
    // Create controller for this dialog
    final controller = Get.put(
      ImageCropperController(imageFile: imageFile, isCircular: isCircular),
    );
    final theme = Theme.of(context);
    
    return Dialog(
      backgroundColor: Colors.black,
      insetPadding: EdgeInsets.zero,
      child: Stack(
        children: [
          // Editor Area
          Positioned.fill(
            bottom: 60, // Space for toolbar
            child: ExtendedImage.file(
              imageFile,
              fit: BoxFit.contain,
              mode: ExtendedImageMode.editor,
              enableLoadState: true,
              cacheRawData: true, // Required for getting raw data
              extendedImageEditorKey: controller.editorKey,
              initEditorConfigHandler: (state) {
                return EditorConfig(
                  maxScale: 8.0,
                  cropRectPadding: const EdgeInsets.all(20.0),
                  hitTestSize: 20.0,
                  initCropRectType: InitCropRectType.imageRect,
                  cropAspectRatio: 1.0, // Force square crop for avatar
                  controller: controller.editorController,
                  editorMaskColorHandler: (context, pointerDown) {
                    return Colors.black.withValues(alpha: 0.5);
                  },
                );
              },
            ),
          ),
          
          // Toolbar
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            height: 60,
            child: Container(
              color: theme.colorScheme.surface,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  TextButton(
                    onPressed: () {
                      Get.delete<ImageCropperController>();
                      Get.back();
                    },
                    child: const Text('取消'),
                  ),
                  Row(
                    children: [
                      IconButton(
                        tooltip: 'Rotate Left',
                        icon: const Icon(Icons.rotate_left),
                        onPressed: controller.rotateLeft,
                      ),
                      IconButton(
                        tooltip: 'Rotate Right',
                        icon: const Icon(Icons.rotate_right),
                        onPressed: controller.rotateRight,
                      ),
                      IconButton(
                        tooltip: 'Reset',
                        icon: const Icon(Icons.restore),
                        onPressed: controller.reset,
                      ),
                    ],
                  ),
                  Obx(() => FilledButton(
                    onPressed: controller.cropping.value 
                        ? null 
                        : () async {
                            final data = await controller.cropImage();
                            if (data != null) {
                              Get.delete<ImageCropperController>();
                              Get.back(result: data);
                            }
                          },
                    child: controller.cropping.value
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('完成'),
                  )),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
