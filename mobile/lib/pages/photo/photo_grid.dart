import 'dart:io';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:path_provider/path_provider.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';
import 'package:peers_touch_mobile/utils/snackbar_utils.dart';
import 'package:video_thumbnail/video_thumbnail.dart';
import 'package:peers_touch_mobile/controller/photo_controller.dart';

class PhotoGridWidget extends StatefulWidget {
  const PhotoGridWidget({super.key});

  @override
  State<PhotoGridWidget> createState() => _PhotoGridWidgetState();
}

class _PhotoGridWidgetState extends State<PhotoGridWidget> {
  final ScrollController _scrollController = ScrollController();
  final PhotoController controller = Get.find<PhotoController>();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_scrollListener);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_scrollListener);
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollListener() {
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 500) {
      _loadMorePhotos();
    }
  }

  void _loadMorePhotos() {
    if (controller.isLoadingMore.value || controller.currentSelectedAlbum.value == null) return;

    controller.loadMorePhotos(controller.currentSelectedAlbum.value!);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () {
                  controller.clearAlbumAndPhotoData();
                },
              ),
              Text(
                controller.currentSelectedAlbum.value!.name,
                style: const TextStyle(fontSize: 18),
              ),
            ],
          ),
        ),
        Expanded(
          child: Obx(() {
            if (controller.photos.isEmpty && controller.currentSelectedAlbum.value != null) {
              return const Center(child: CircularProgressIndicator());
            }

            return GridView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
                childAspectRatio: 1,
              ),
              itemCount: controller.photos.length + (controller.isLoadingMore.value ? 1 : 0),
              physics: const AlwaysScrollableScrollPhysics(),
              itemBuilder: (context, index) {
                // Show loading indicator at the bottom
                if (controller.isLoadingMore.value && index == controller.photos.length) {
                  return const Center(child: CircularProgressIndicator());
                }

                final photo = controller.photos[index];
                return GestureDetector(
                    key: ValueKey(photo.id),
                    onTap: () {
                      controller.togglePhotoSelection(photo.id);
                    },
                    behavior: HitTestBehavior.opaque,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        const SizedBox.expand(),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: FutureBuilder<File?>(
                            future: isVideoFile(photo.path)
                                ? getVideoThumbnail(photo.path)
                                : Future.value(File(photo.path)),
                            builder: (context, snapshot) {
                              if (snapshot.hasData) {
                                return Image.file(
                                  snapshot.data!,
                                  fit: BoxFit.cover,
                                  errorBuilder: (context, error, stackTrace) =>
                                      const Icon(Icons.broken_image),
                                );
                              } else if (snapshot.hasError) {
                                return const Icon(Icons.broken_image);
                              }
                              return const CircularProgressIndicator();
                            },
                          ),
                        ),
                        if (controller.syncedPhotos.contains(photo.id))
                          Container(
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.4),
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                        Align(
                          alignment: Alignment.topRight,
                          child: Obx(() => Container(
                            margin: const EdgeInsets.all(4),
                            decoration: BoxDecoration(
                              color: controller.selectedPhotos
                                      .contains(photo.id)
                                  ? Colors.blue
                                  : Colors.grey,
                              shape: BoxShape.circle,
                            ),
                            child: Opacity(
                              opacity: controller.selectedPhotos
                                      .contains(photo.id)
                                  ? 1
                                  : 0,
                              child: const Icon(
                                Icons.check,
                                color: Colors.white,
                                size: 16,
                              ),
                            ),
                          ),),
                        ),
                      ],
                    ),
                  );
                },
              );
            }),
          ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Obx(() =>
              ElevatedButton(
                onPressed: controller.selectedPhotos.isNotEmpty && controller.isServerAvailable.value
                    ? () async {
                  try {
                    final success = await controller.uploadSelectedPhotos();
                    if (success) {
                      SnackbarUtils.showSuccess('Success', 'Photos synced successfully');
                    } else {
                      SnackbarUtils.showError('Error', 'Failed to sync photos');
                    }
                  } catch (e) {
                    SnackbarUtils.showError('Error', 'An unexpected error occurred: $e');
                  }
                }
                    : null,
                child: Text('Sync Selected Photos (${controller.selectedPhotos
                    .length})'),
              )),
        ),
      ],
    );
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

  bool isVideoFile(String path) {
    final ext = path.split('.').last.toLowerCase();
    return ['mp4', 'mov', 'avi', 'mkv'].contains(ext);
  }
}
