import 'dart:io';

import 'package:extended_image/extended_image.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image/image.dart' as img;

/// Controller for ImageCropperDialog
/// Per ADR-002: All state managed via GetX Controller
class ImageCropperController extends GetxController {
  ImageCropperController({
    required this.imageFile,
    this.isCircular = true,
  });
  
  final File imageFile;
  final bool isCircular;
  
  final GlobalKey<ExtendedImageEditorState> editorKey = GlobalKey<ExtendedImageEditorState>();
  final ImageEditorController editorController = ImageEditorController();
  final cropping = false.obs;
  
  @override
  void onClose() {
    editorController.dispose();
    super.onClose();
  }
  
  void rotateLeft() {
    editorController.rotate();
    editorController.rotate();
    editorController.rotate();
  }
  
  void rotateRight() {
    editorController.rotate();
  }
  
  void reset() {
    editorController.reset();
  }
  
  Future<Uint8List?> cropImage() async {
    if (cropping.value) return null;
    cropping.value = true;

    try {
      final state = editorKey.currentState;
      if (state == null) return null;

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
        isCircular: isCircular,
      );
      
      return await compute(dartCrop, params);
      
    } catch (e) {
      debugPrint('Crop error: $e');
      Get.snackbar('Error', 'Cropping failed: $e');
      return null;
    } finally {
      cropping.value = false;
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
