import 'package:flutter/material.dart';

import 'package:get/get.dart';

import 'package:peers_touch_mobile/controller/photo_controller.dart';
import 'package:peers_touch_mobile/pages/photo/photo_post_item.dart';
import 'package:peers_touch_mobile/pages/photo/profile_header.dart';
import 'package:peers_touch_mobile/pages/photo/avatar_overlay.dart';
import 'package:peers_touch_mobile/components/common/floating_action_ball.dart';

import 'package:peers_touch_mobile/controller/controller.dart';
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

class PhotoPage extends GetView<PhotoController> {
  PhotoPage({super.key});

  static final List<FloatingActionOption> actionOptions = [
    FloatingActionOption(
      icon: Icons.cloud_sync,
      tooltip: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.syncPhotos, 'Sync Photos'),
      onPressed: () => ControllerManager.photoController.showSyncPhotoDrawer(),
    ),
    FloatingActionOption(
      icon: Icons.cloud_download,
      tooltip: 'View Backend Photos',
      onPressed: () => Get.toNamed('/backend-photos'),
    ),
    FloatingActionOption(
      icon: Icons.camera_alt,
      tooltip: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.takePhoto, 'Take Photo'),
      onPressed: () => appLogger.info('Take Photo pressed'),
    ),
    FloatingActionOption(
      icon: Icons.photo_library,
      tooltip: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.uploadPhoto, 'Upload Photo'),
      onPressed: () => appLogger.info('Upload Photo pressed'),
    ),
  ];

  // Add a key to track the header's size
  final GlobalKey _headerKey = GlobalKey();

  double _getHeaderHeight() {
    final headerBox =
        _headerKey.currentContext?.findRenderObject() as RenderBox?;
    return headerBox?.size.height ?? 200; // Fallback if measurement fails
  }

  @override
  Widget build(BuildContext context) {
    final scrollController = ControllerManager.scrollController.getScrollController('photo_page');

    return Scaffold(
      body: ListView.builder(
        controller: scrollController,
        padding: const EdgeInsets.only(top: 0),
        itemCount: 12, // Header + divider + 10 posts
        itemBuilder: (context, index) {
          if (index == 0) {
            return Stack(
              clipBehavior: Clip.none,
              children: [
                SizedBox(key: _headerKey, child: const ProfileHeader()),
                Positioned(
                  top: _getHeaderHeight() - 38,
                  right: 16,
                  child: const AvatarOverlay(),
                ),
              ],
            );
          } else if (index == 1) {
            // Divider between header and posts (positioned below bio)
            return Container(
              margin: const EdgeInsets.only(top: 60), // Add margin to position below bio
              child: const Divider(
                height: 20,
                thickness: 0.5,
                color: Colors.grey,
                indent: 0,
                endIndent: 0,
              ),
            );
          } else {
            // Post items (adjust index by -2 to account for header and divider)
            return const PhotoPostItem();
          }
        },
      ),
    );
  }
}
