import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:path_provider/path_provider.dart';
import 'package:peers_touch_mobile/pages/photo/photo_grid.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';
import 'package:video_thumbnail/video_thumbnail.dart';

import 'package:peers_touch_mobile/controller/photo_controller.dart';
import 'package:peers_touch_mobile/pages/photo/album_list.dart';

class PhotoSelectionSheet extends StatelessWidget {
  const PhotoSelectionSheet({super.key});

  @override
  Widget build(BuildContext context) {
    final PhotoController photoController = Get.find<PhotoController>();
    
    // Check server connectivity when opening PhotoSelectionSheet
    WidgetsBinding.instance.addPostFrameCallback((_) {
      photoController.checkServerConnectivity();
    });
    
    if (kDebugMode) {
      appLogger.info('Building PhotoSelectionSheet');
      appLogger.info('Current selected album: ${photoController.currentSelectedAlbum.value?.name ?? "None"}');
    }
    
    return SafeArea(
      child: Container(
        height: Get.height * 0.9,
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
      child: Column(
        children: [
          // Server connectivity status header
          Obx(() => Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: photoController.isServerAvailable.value 
                ? Colors.green.withValues(alpha: 0.1) 
                : Colors.red.withValues(alpha: 0.1),
              border: Border(
                bottom: BorderSide(
                  color: photoController.isServerAvailable.value 
                    ? Colors.green 
                    : Colors.red,
                  width: 1,
                ),
              ),
            ),
            child: Row(
              children: [
                Icon(
                  photoController.isServerAvailable.value 
                    ? Icons.cloud_done 
                    : Icons.cloud_off,
                  color: photoController.isServerAvailable.value 
                    ? Colors.green 
                    : Colors.red,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Text(
                  photoController.isServerAvailable.value 
                    ? 'Server Connected' 
                    : 'Server Disconnected',
                  style: TextStyle(
                    color: photoController.isServerAvailable.value 
                      ? Colors.green 
                      : Colors.red,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (photoController.isCheckingServerConnection.value) ...[
                  const Spacer(),
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  ),
                ],
              ],
            ),
          )),
          // Main content
          Expanded(
            child: GetBuilder<PhotoController>(
              builder: (controller) {
                if (kDebugMode) {
                  print('GetBuilder rebuilding with album: ${controller.currentSelectedAlbum.value?.name ?? "None"}');
                }
                
                return Obx(() {
            if (kDebugMode) {
              print('Obx rebuilding with album: ${controller.currentSelectedAlbum.value?.name ?? "None"}');
              print('Photos count: ${controller.photos.length}');
              
              // Check if photos are loaded correctly
              if (controller.photos.isNotEmpty) {
                print('First photo path in sheet: ${controller.photos.first.path}');
                try {
                  final exists = File(controller.photos.first.path).existsSync();
                  print('Photo exists in sheet: $exists');
                } catch (e) {
                  print('Error checking if photo exists: $e');
                }
              }
            }
            
            if (controller.currentSelectedAlbum.value == null) {
              return const AlbumListWidget();
            } else {
              if (controller.photos.isEmpty) {
                return Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const CircularProgressIndicator(),
                      const SizedBox(height: 16),
                      Text('Loading photos from ${controller.currentSelectedAlbum.value?.name ?? "album"}...'),
                    ],
                  ),
                );
              }
              return const PhotoGridWidget();
            }
          });
        },
      ),
    ),
        ],
      ),
    ),
    );
  }
}

/// Generates a video thumbnail from the given video path.
///
/// Returns a [Future<File?>] representing the thumbnail file.
Future<File?> getVideoThumbnail(String videoPath) async {
  try {
    final thumbnailPath = await VideoThumbnail.thumbnailFile(
      video: videoPath,
      thumbnailPath: (await getTemporaryDirectory()).path,
      imageFormat: ImageFormat.JPEG,
      maxHeight: 50,
      maxWidth: 50,
      quality: 75,
    );
    return thumbnailPath != null ? File(thumbnailPath) : null;
  } catch (e) {
    appLogger.error('Error generating video thumbnail: $e');
    return null;
  }
}
