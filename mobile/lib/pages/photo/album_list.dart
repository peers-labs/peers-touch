import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:photo_manager/photo_manager.dart';

import 'package:peers_touch_mobile/controller/album_controller.dart';
import 'package:peers_touch_mobile/controller/photo_controller.dart';
import 'package:peers_touch_mobile/controller/controller.dart';

class AlbumListWidget extends GetView<AlbumController> {
  const AlbumListWidget({super.key});

  @override
  Widget build(BuildContext context) {
    final scrollController = ControllerManager.scrollController
        .getScrollController('album_list');
    final PhotoController photoController = Get.find<PhotoController>();

    // Load albums every time the widget is built (no caching)
    WidgetsBinding.instance.addPostFrameCallback((_) {
      controller.loadAlbums();
    });

    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.all(16),
          child: Text('Sync Albums', style: TextStyle(fontSize: 18)),
        ),
        Expanded(
          child: Obx(() {
            // Check permission state first
            if (photoController.hasCheckedPermission &&
                photoController.isPermissionDenied) {
              return _PermissionDeniedWidget();
            }

            return controller.albums.isEmpty
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                  controller: scrollController,
                  itemCount: controller.albums.length,
                  itemBuilder: (context, index) {
                    final album = controller.albums[index];
                    return ListTile(
                      leading: _AlbumThumbnail(album: album),
                      title: Text(album.name),
                      subtitle: _AlbumCountSubtitle(album: album),
                      trailing: Obx(
                        () => Checkbox(
                          value: controller.selectedAlbums.contains(album),
                          onChanged: (value) {
                            if (value != null) {
                              controller.toggleAlbumSelection(album);
                            }
                          },
                        ),
                      ),
                      onTap: () {
                        // Navigate to photo list when tapping on album
                        if (kDebugMode) {
                          print('Album tapped: ${album.name}');
                        }
                        // Defer the state change to avoid build-time setState errors
                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          photoController.loadPhotosForAlbum(album);
                        });
                      },
                    );
                  },
                );
          }),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Obx(
            () {
              final PhotoController photoController = Get.find<PhotoController>();
              return ElevatedButton(
                onPressed:
                    controller.selectedAlbums.isNotEmpty && photoController.isServerAvailable.value
                        ? () async {
                        try {
                          final PhotoController photoController =
                              Get.find<PhotoController>();

                          // Check if there are albums to sync
                          if (controller.selectedAlbums.isEmpty) {
                            Get.snackbar(
                              'Warning',
                              'No albums selected for sync',
                            );
                            return;
                          }

                          // Check network connectivity (basic check)
                          final success =
                              await photoController.uploadSelectedPhotos();
                          if (success) {
                            Get.snackbar(
                              'Success',
                              'Albums synced successfully',
                            );
                          } else {
                            Get.snackbar(
                              'Sync Failed',
                              'Upload failed. Check:\n• Network connection\n• Server availability\n• Photo permissions\n• Storage space',
                              duration: const Duration(seconds: 5),
                              snackPosition: SnackPosition.BOTTOM,
                            );
                          }
                        } catch (e) {
                          String errorMsg = 'Sync error: ';
                          if (e.toString().contains('SocketException')) {
                            errorMsg += 'Network connection failed';
                          } else if (e.toString().contains(
                            'TimeoutException',
                          )) {
                            errorMsg += 'Request timed out';
                          } else if (e.toString().contains('FormatException')) {
                            errorMsg += 'Invalid server response';
                          } else if (e.toString().contains('Permission')) {
                            errorMsg += 'Photo access permission denied';
                          } else {
                            errorMsg += e.toString();
                          }
                          Get.snackbar(
                            'Error',
                            errorMsg,
                            duration: const Duration(seconds: 5),
                            snackPosition: SnackPosition.BOTTOM,
                          );
                        }
                      }
                      : null,
              child: Text(
                'Sync Selected Albums (${controller.selectedAlbums.length})',
              ),
            );
          },
          ),
        ),
      ],
    );
  }
}

class _PermissionDeniedWidget extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final PhotoController photoController = Get.find<PhotoController>();

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.photo_library_outlined,
              size: 80,
              color: Colors.grey[400],
            ),
            const SizedBox(height: 24),
            Text(
              'Photo Access Required',
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            Text(
              'This app needs access to your photos to display and manage your albums. '
              'Please grant photo access to continue.',
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: Colors.grey[600]),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            ElevatedButton.icon(
              onPressed: () async {
                // Request permission again
                final hasPermission =
                    await photoController.requestPhotoPermission();
                if (hasPermission) {
                  // Reload albums if permission granted
                  final AlbumController albumController =
                      Get.find<AlbumController>();
                  albumController.loadAlbums();
                }
              },
              icon: const Icon(Icons.settings),
              label: const Text('Grant Permission'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 24,
                  vertical: 12,
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () async {
                // Open device settings
                await PhotoManager.openSetting();
              },
              child: const Text('Open Device Settings'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AlbumThumbnailController extends GetxController {
  final AssetPathEntity album;

  final Rx<AssetEntity?> firstAsset = Rx<AssetEntity?>(null);
  final Rx<Uint8List?> thumbnailData = Rx<Uint8List?>(null);
  final RxBool isLoading = true.obs;
  final RxBool hasError = false.obs;

  _AlbumThumbnailController(this.album);

  @override
  void onInit() {
    super.onInit();
    loadThumbnail();
  }

  Future<void> loadThumbnail() async {
    try {
      isLoading.value = true;
      hasError.value = false;

      final assets = await album.getAssetListRange(start: 0, end: 1);
      if (assets.isNotEmpty) {
        firstAsset.value = assets.first;
        // Use a smaller thumbnail size for better performance
        thumbnailData.value = await firstAsset.value!.thumbnailDataWithSize(
          const ThumbnailSize(120, 120),
        );
      }
    } catch (e) {
      hasError.value = true;
    } finally {
      isLoading.value = false;
    }
  }
}

class _AlbumThumbnail extends GetView<_AlbumThumbnailController> {
  final AssetPathEntity album;

  const _AlbumThumbnail({required this.album});

  @override
  String get tag => album.id;

  @override
  Widget build(BuildContext context) {
    // Initialize controller if not already done
    Get.put(_AlbumThumbnailController(album), tag: tag);

    return Obx(() {
      if (controller.isLoading.value) {
        return Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: Colors.grey[300],
            borderRadius: BorderRadius.circular(4),
          ),
          child: const Center(
            child: SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
        );
      }

      if (controller.hasError.value ||
          controller.firstAsset.value == null ||
          controller.thumbnailData.value == null) {
        return Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: Colors.grey[300],
            borderRadius: BorderRadius.circular(4),
          ),
          child: const Icon(Icons.photo_album, color: Colors.grey),
        );
      }

      return Container(
        width: 50,
        height: 50,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(4),
          image: DecorationImage(
            image: MemoryImage(controller.thumbnailData.value!),
            fit: BoxFit.cover,
          ),
        ),
        child:
            controller.firstAsset.value!.type == AssetType.video
                ? const Align(
                  alignment: Alignment.bottomRight,
                  child: Padding(
                    padding: EdgeInsets.all(2.0),
                    child: Icon(Icons.videocam, color: Colors.white, size: 16),
                  ),
                )
                : null,
      );
    });
  }
}

class _AlbumCountSubtitleController extends GetxController {
  final AssetPathEntity album;

  final Rx<int?> count = Rx<int?>(null);
  final RxBool isLoading = true.obs;
  final RxBool hasError = false.obs;

  _AlbumCountSubtitleController(this.album);

  @override
  void onInit() {
    super.onInit();
    loadCount();
  }

  Future<void> loadCount() async {
    try {
      isLoading.value = true;
      hasError.value = false;
      count.value = await album.assetCountAsync;
    } catch (e) {
      hasError.value = true;
    } finally {
      isLoading.value = false;
    }
  }
}

class _AlbumCountSubtitle extends GetView<_AlbumCountSubtitleController> {
  final AssetPathEntity album;

  const _AlbumCountSubtitle({required this.album});

  @override
  String get tag => '${album.id}_count';

  @override
  Widget build(BuildContext context) {
    // Initialize controller if not already done
    Get.put(_AlbumCountSubtitleController(album), tag: tag);

    return Obx(() {
      if (controller.isLoading.value) {
        return const Text('Loading...', style: TextStyle(color: Colors.grey));
      }

      if (controller.hasError.value || controller.count.value == null) {
        return const Text(
          'Error loading count',
          style: TextStyle(color: Colors.red),
        );
      }

      return Text('${controller.count.value} items');
    });
  }
}
