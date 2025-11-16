import 'package:get/get.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:peers_touch_mobile/controller/photo_controller.dart';

class AlbumController extends GetxController {
  final RxList<AssetPathEntity> albums = <AssetPathEntity>[].obs;
  final RxSet<AssetPathEntity> selectedAlbums = <AssetPathEntity>{}.obs;

  Future<void> loadAlbums() async {
    final photoController = Get.find<PhotoController>();
    final bool hasPermission = await photoController.requestPhotoPermission();
    if (!hasPermission) {
      return;
    }

    // Clear existing albums and selected states to ensure fresh load
    albums.clear();
    selectedAlbums.clear();
    
    // Also clear PhotoController selected albums if available
    try {
      photoController.selectedAlbums.clear();
    } catch (e) {
      // PhotoController might not be available, ignore
    }

    final List<AssetPathEntity> paths = await PhotoManager.getAssetPathList(
      type: RequestType.common,
    );
    albums.assignAll(paths);
  }

  void toggleAlbumSelection(AssetPathEntity album) {
    if (selectedAlbums.contains(album)) {
      selectedAlbums.remove(album);
    } else {
      selectedAlbums.add(album);
    }
  }

  // Upload functionality moved to PhotoController.uploadSelectedPhotos()

  void clearAllStates() {
    selectedAlbums.clear();
    albums.clear();
  }

  void clearSelectedStates() {
    selectedAlbums.clear();

    // Also clear PhotoController selected albums if available
    try {
      final photoController = Get.find<PhotoController>();
      photoController.selectedAlbums.clear();
    } catch (e) {
      // PhotoController might not be available, ignore
    }
  }

  @override
  void onClose() {
    // Clear all states when controller is disposed
    selectedAlbums.clear();
    albums.clear();

    // Also clear PhotoController selected albums if available
    try {
      final photoController = Get.find<PhotoController>();
      photoController.selectedAlbums.clear();
    } catch (e) {
      // PhotoController might not be available, ignore
    }

    super.onClose();
  }
}
