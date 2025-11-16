import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_mobile/controller/profile_controller.dart';
import 'package:peers_touch_mobile/components/common/fullscreen_image_viewer.dart';
import 'package:peers_touch_mobile/pages/photo/image_selection_page.dart';
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';

class ProfileHeader extends StatelessWidget {
  const ProfileHeader({super.key});

  @override
  Widget build(BuildContext context) {
    final ProfileController controller = Get.put(ProfileController());

    return Obx(() => _buildContent(controller));
  }

  void _showFullscreenImage(ProfileController controller) {
    if (controller.hasProfileImage.value) {
      // Create FileImage with cache busting by using a unique key
      final imageProvider = FileImage(
        controller.profileImage.value!,
      );
      // Force evict from cache to ensure fresh image
      imageProvider.evict();
      
      FullscreenImageViewerHelper.show(
        Get.context!,
        imageProvider,
        heroTag: 'profile_image',
        onEdit: () => Get.to(() => const ImageSelectionPage()),
      );
    } else {
      FullscreenImageViewerHelper.show(
        Get.context!,
        const AssetImage('assets/images/photo_profile_header_default.jpg'),
        heroTag: 'profile_image',
        onEdit: () => Get.to(() => const ImageSelectionPage()),
      );
    }
  }

  Widget _buildContent(ProfileController controller) {
    return Stack(
      children: [
        GestureDetector(
          onTap: () => _showFullscreenImage(controller),
          child: Container(
            height: 200,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Theme.of(Get.context!).colorScheme.surfaceContainerHighest,
              borderRadius: const BorderRadius.vertical(
                bottom: Radius.circular(20),
              ),
            ),
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                bottom: Radius.circular(20),
              ),
              child: Stack(
                children: [
                  if (controller.isLoading.value)
                    const Center(child: CircularProgressIndicator())
                  else if (controller.hasProfileImage.value)
                    Hero(
                      tag: 'profile_image',
                      child: Image.file(
                        controller.profileImage.value!,
                        key: ValueKey('profile_image_${controller.imageVersion.value}'), // Cache busting key
                        width: double.infinity,
                        height: 200,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) {
                          return Container(
                            width: double.infinity,
                            height: 200,
                            color: Theme.of(context).colorScheme.surfaceContainerHighest,
                            child: Icon(
                              Icons.person,
                              size: 80,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                          );
                        },
                      ),
                    )
                  else
                    Hero(
                      tag: 'profile_image',
                      child: Image.asset(
                        'assets/images/photo_profile_header_default.jpg',
                        width: double.infinity,
                        height: 200,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) {
                          return Container(
                            width: double.infinity,
                            height: 200,
                            color: Theme.of(context).colorScheme.surfaceContainerHighest,
                            child: Icon(
                              Icons.person,
                              size: 80,
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                          );
                        },
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        // User name positioned closer to avatar
        Positioned(
          bottom: 4,
          right: 90,
          child: Text(
              AppLocalizationsHelper.getLocalizedString((l10n) => l10n.userName, 'User Name'),
            style: TextStyle(
              color: Colors.white, // Keeping white for contrast against photo background
              fontSize: 16,
              fontWeight: FontWeight.bold,
              shadows: const [
                Shadow(
                  color: Colors.black54,
                  blurRadius: 4,
                  offset: Offset(0, 2),
                ),
              ],
            ),
          ),
        ),

      ],
    );
  }
}
