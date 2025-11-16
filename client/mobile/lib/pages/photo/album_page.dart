import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/album_controller.dart';
import 'package:peers_touch_mobile/controller/photo_controller.dart';
import 'package:peers_touch_mobile/pages/photo/album_list.dart';
import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';

class AlbumPage extends StatelessWidget {
  static final List<FloatingActionOption> actionOptions = [
    FloatingActionOption(
      icon: Icons.cloud_sync,
      tooltip: 'Sync Selected Albums',
      onPressed: () {
        final controller = Get.find<AlbumController>();
        if (controller.selectedAlbums.isEmpty) {
          Get.snackbar(
            'No Albums Selected',
            'Please select at least one album to sync',
          );
          return;
        }
        final photoController = Get.find<PhotoController>();
        // Transfer selected albums to PhotoController
        photoController.selectedAlbums.addAll(controller.selectedAlbums);
        photoController.uploadSelectedPhotos();
      },
    ),
    FloatingActionOption(
      icon: Icons.select_all,
      tooltip: 'Select All',
      onPressed: () {
        final controller = Get.find<AlbumController>();
        // Add all albums to selected albums
        controller.selectedAlbums.addAll(controller.albums);
      },
    ),
    FloatingActionOption(
      icon: Icons.deselect,
      tooltip: 'Deselect All',
      onPressed: () {
        final controller = Get.find<AlbumController>();
        controller.selectedAlbums.clear();
      },
    ),
  ];

  const AlbumPage({super.key});

  @override
  Widget build(BuildContext context) {
    // Ensure AlbumController is initialized
    Get.put(AlbumController());

    return PopScope(
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) {
          // Clear selected states when navigating back
          try {
            final albumController = Get.find<AlbumController>();
            albumController.clearSelectedStates();
          } catch (e) {
            // Controllers might not be initialized, ignore error
          }
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Photo Albums'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () {
              // Clear selected states when using back button
              try {
                final albumController = Get.find<AlbumController>();
                albumController.clearSelectedStates();
              } catch (e) {
                // Controllers might not be initialized, ignore error
              }
              Get.back();
            },
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.info_outline),
              onPressed: () {
                Get.dialog(
                  AlertDialog(
                    title: const Text('Album Sync'),
                    content: const Text(
                      'Select albums to sync with your account. '
                      'Synced albums will be available across all your devices.',
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Get.back(),
                        child: const Text('OK'),
                      ),
                    ],
                  ),
                );
              },
            ),
          ],
        ),
        body: const AlbumListWidget(),
        floatingActionButton: FloatingActionBall(options: actionOptions),
      ),
    );
  }
}
