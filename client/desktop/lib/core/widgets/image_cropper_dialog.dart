import 'dart:io';

import 'package:extended_image/extended_image.dart';
import 'package:flutter/foundation.dart'; // For compute
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image/image.dart' as img;

class ImageCropperDialog extends StatefulWidget {

  const ImageCropperDialog({
    super.key,
    required this.imageFile,
    this.isCircular = true,
  });
  final File imageFile;
  final bool isCircular;

  @override
  State<ImageCropperDialog> createState() => _ImageCropperDialogState();
}

class _ImageCropperDialogState extends State<ImageCropperDialog> {
  final GlobalKey<ExtendedImageEditorState> _editorKey = GlobalKey<ExtendedImageEditorState>();
  final ImageEditorController _editorController = ImageEditorController();
  bool _cropping = false;

  @override
  void dispose() {
    _editorController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
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
              widget.imageFile,
              fit: BoxFit.contain,
              mode: ExtendedImageMode.editor,
              enableLoadState: true,
              cacheRawData: true, // Required for getting raw data
              extendedImageEditorKey: _editorKey,
              initEditorConfigHandler: (state) {
                return EditorConfig(
                  maxScale: 8.0,
                  cropRectPadding: const EdgeInsets.all(20.0),
                  hitTestSize: 20.0,
                  initCropRectType: InitCropRectType.imageRect,
                  cropAspectRatio: 1.0, // Force square crop for avatar
                  controller: _editorController,
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
                    onPressed: () => Get.back(),
                    child: const Text('取消'),
                  ),
                  Row(
                    children: [
                      IconButton(
                        tooltip: 'Rotate Left',
                        icon: const Icon(Icons.rotate_left),
                        onPressed: () {
                          _editorController.rotate();
                          _editorController.rotate();
                          _editorController.rotate();
                        },
                      ),
                      IconButton(
                        tooltip: 'Rotate Right',
                        icon: const Icon(Icons.rotate_right),
                        onPressed: () {
                          _editorController.rotate();
                        },
                      ),
                      IconButton(
                        tooltip: 'Reset',
                        icon: const Icon(Icons.restore),
                        onPressed: () {
                          _editorController.reset();
                        },
                      ),
                    ],
                  ),
                  FilledButton(
                    onPressed: _cropping ? null : _cropImage,
                    child: _cropping
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('完成'),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _cropImage() async {
    if (_cropping) return;
    setState(() => _cropping = true);

    try {
      final state = _editorKey.currentState;
      if (state == null) return;

      final Rect? cropRect = state.getCropRect();
      final EditActionDetails? action = state.editAction;
      
      final rotateAngle = action?.rotateDegrees.toInt() ?? 0;

      // Get raw image data
      final Uint8List imgData = state.rawImageData;

      // Use compute to crop in background isolate
      final params = CropParams(
        fileData: imgData,
        cropRect: cropRect!,
        rotateAngle: rotateAngle,
        isCircular: widget.isCircular,
      );
      
      final data = await compute(dartCrop, params);
      Get.back(result: data);
      
    } catch (e) {
      debugPrint('Crop error: $e');
      Get.snackbar('Error', 'Cropping failed: $e');
    } finally {
      if (mounted) setState(() => _cropping = false);
    }
  }
}

class CropParams {
  CropParams({
    required this.fileData,
    required this.cropRect,
    required this.rotateAngle,
    required this.isCircular,
  });
  final Uint8List fileData;
  final Rect cropRect;
  final int rotateAngle;
  final bool isCircular;
}

/// Top-level function for compute
Future<Uint8List?> dartCrop(CropParams params) async {
  img.Image? src = img.decodeImage(params.fileData);
  if (src == null) return null;

  // 1. Bake rotation
  src = img.bakeOrientation(src);
  if (params.rotateAngle != 0) {
    src = img.copyRotate(src, angle: params.rotateAngle);
  }

  // 2. Crop
  int x = params.cropRect.left.toInt();
  int y = params.cropRect.top.toInt();
  int w = params.cropRect.width.toInt();
  int h = params.cropRect.height.toInt();

  // Boundary checks
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + w > src.width) w = src.width - x;
  if (y + h > src.height) h = src.height - y;

  img.Image cropped = img.copyCrop(src, x: x, y: y, width: w, height: h);

  if (params.isCircular) {
    // Resize for avatar usage (optimize size)
    // We stick to square image for now, UI handles circular clip.
    // Max size 512x512 is usually enough for avatars
    if (cropped.width > 512 || cropped.height > 512) {
      cropped = img.copyResize(cropped, width: 512, height: 512);
    }
  }

  return Uint8List.fromList(img.encodePng(cropped));
}
