import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:photo_manager_image_provider/photo_manager_image_provider.dart';
import 'package:peers_touch_mobile/controller/profile_controller.dart';
import 'package:peers_touch_mobile/utils/app_localizations_helper.dart';

class ImageSelectionPage extends StatelessWidget {
  const ImageSelectionPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(AppLocalizationsHelper.getLocalizedString((l10n) => l10n.selectProfilePicture, 'Select Profile Picture')),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Get.back(),
        ),
      ),
      body: Container(
        color: Colors.white,
        child: Column(
          children: [
            const SizedBox(height: 20),
            _buildOptionTile(
              icon: Icons.photo_library,
              title: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.chooseFromGallery, 'Choose from Gallery'),
              subtitle: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.selectFromPhotos, 'Select from your photos'),
              onTap: () => _openGallery(),
            ),
            const Divider(height: 1),
            _buildOptionTile(
              icon: Icons.photo,
              title: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.chooseFromPosts, 'Choose from Posts'),
              subtitle: AppLocalizationsHelper.getLocalizedString((l10n) => l10n.comingSoon, 'Coming soon...'),
              onTap: () => _showComingSoon(),
              enabled: false,
            ),
            const Divider(height: 1),
          ],
        ),
      ),
    );
  }

  Widget _buildOptionTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
    bool enabled = true,
  }) {
    return ListTile(
      leading: Container(
        width: 48,
        height: 48,
        decoration: BoxDecoration(
          color: enabled ? Colors.blue.withValues(alpha: 0.1) : Colors.grey.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(
          icon,
          color: enabled ? Colors.blue : Colors.grey,
          size: 24,
        ),
      ),
      title: Text(
        title,
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w500,
          color: enabled ? Colors.black : Colors.grey,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: TextStyle(
          fontSize: 14,
          color: enabled ? Colors.grey[600] : Colors.grey[400],
        ),
      ),
      trailing: Icon(
        Icons.arrow_forward_ios,
        size: 16,
        color: enabled ? Colors.grey[400] : Colors.grey[300],
      ),
      onTap: enabled ? onTap : null,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
    );
  }

  void _openGallery() {
    Get.to(() => const GallerySelectionPage());
  }

  void _showComingSoon() {
    Get.snackbar(
      AppLocalizationsHelper.getLocalizedString((l10n) => l10n.comingSoonTitle, 'Coming Soon'),
        AppLocalizationsHelper.getLocalizedString((l10n) => l10n.comingSoonMessage, 'This feature will be available in future updates'),
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.grey[800],
      colorText: Colors.white,
    );
  }
}

class GallerySelectionPage extends StatefulWidget {
  const GallerySelectionPage({super.key});

  @override
  State<GallerySelectionPage> createState() => _GallerySelectionPageState();
}

class _GallerySelectionPageState extends State<GallerySelectionPage> {
  final ProfileController controller = Get.find<ProfileController>();
  List<AssetEntity> assets = [];
  bool isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadPhotos();
  }

  Future<void> _loadPhotos() async {
    try {
      final PermissionState permission = await PhotoManager.requestPermissionExtend();
      if (permission != PermissionState.authorized) {
        Get.back();
        Get.snackbar(
          AppLocalizationsHelper.getLocalizedString((l10n) => l10n.permissionDenied, 'Permission Denied'), 
          AppLocalizationsHelper.getLocalizedString((l10n) => l10n.needPhotoAccess, 'Need photo access to select profile image')
        );
        return;
      }

      final List<AssetPathEntity> paths = await PhotoManager.getAssetPathList(
        onlyAll: true,
        type: RequestType.image,
      );

      if (paths.isNotEmpty) {
        final List<AssetEntity> photoAssets = await paths.first.getAssetListPaged(
          page: 0,
          size: 100,
        );
        setState(() {
          assets = photoAssets;
          isLoading = false;
        });
      } else {
        setState(() {
          isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        isLoading = false;
      });
      Get.snackbar(
          AppLocalizationsHelper.getLocalizedString((l10n) => l10n.error, 'Error'), 
          'Failed to load photos: $e'
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(AppLocalizationsHelper.getLocalizedString((l10n) => l10n.selectPhoto, 'Select Photo')),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Get.back(),
        ),
      ),
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : assets.isEmpty
              ? Center(child: Text(AppLocalizationsHelper.getLocalizedString((l10n) => l10n.noPhotosFound, 'No photos found')))
              : GridView.builder(
                  padding: const EdgeInsets.all(8),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 4,
                    mainAxisSpacing: 4,
                    childAspectRatio: 1,
                  ),
                  itemCount: assets.length,
                  itemBuilder: (context, index) {
                    final asset = assets[index];
                    return GestureDetector(
                      onTap: () => _selectImage(asset),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(8),
                        child: Image(
                          image: AssetEntityImageProvider(
                            asset,
                            isOriginal: false,
                            thumbnailSize: const ThumbnailSize.square(200),
                          ),
                          fit: BoxFit.cover,
                        ),
                      ),
                    );
                  },
                ),
    );
  }

  Future<void> _selectImage(AssetEntity asset) async {
    try {
      await controller.setProfileImageFromAsset(asset);
      // Navigate back to the avatar change page (close gallery, selection page, and fullscreen viewer)
      Get.back(); // Close gallery page
      Get.back(); // Close selection page
      Get.back(); // Close fullscreen viewer if it exists
      Get.snackbar(
          AppLocalizationsHelper.getLocalizedString((l10n) => l10n.success, 'Success'),
          AppLocalizationsHelper.getLocalizedString((l10n) => l10n.profilePictureUpdated, 'Profile picture updated successfully'),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.green,
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar(
          AppLocalizationsHelper.getLocalizedString((l10n) => l10n.error, 'Error'), 
          'Failed to set profile image: $e'
        );
    }
  }
}