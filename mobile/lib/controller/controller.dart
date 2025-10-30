import 'package:get/get.dart';

import 'package:peers_touch_mobile/controller/photo_controller.dart';
import 'package:peers_touch_mobile/controller/album_controller.dart';
import 'package:peers_touch_mobile/controller/device_id_controller.dart';
import 'package:peers_touch_mobile/controller/scroll_controller.dart';
import 'package:peers_touch_mobile/controller/me_controller.dart';
import 'package:peers_touch_mobile/controller/profile_controller.dart';
import 'package:peers_touch_mobile/store/sync_manager.dart';

class ControllerManager {
  static final ControllerManager _instance = ControllerManager._internal();

  factory ControllerManager() {
    return _instance;
  }

  ControllerManager._internal() {
    // Initialize all controllers in the correct order
    // First initialize device ID and sync manager
    _deviceIdController = Get.put(DeviceIdController());
    _syncManager = Get.put(SyncManager());
    
    // Then initialize controllers that depend on sync manager
    _meController = Get.put(MeController());
    _profileController = Get.put(ProfileController());
    _photoController = Get.put(PhotoController());
    _albumController = Get.put(AlbumController());
    _scrollController = Get.put(AppScrollController());
  }

  // Add your controllers here
  // Example:
  static DeviceIdController get deviceIdController => _instance._deviceIdController;
  static SyncManager get syncManager => _instance._syncManager;
  static PhotoController get photoController => _instance._photoController;
  static AlbumController get albumController => _instance._albumController;
  static AppScrollController get scrollController => _instance._scrollController;
  static MeController get meController => _instance._meController;
  static ProfileController get profileController => _instance._profileController;
  
  late final DeviceIdController _deviceIdController;
  late final SyncManager _syncManager;
  late final AlbumController _albumController;
  late final PhotoController _photoController;
  late final AppScrollController _scrollController;
  late final MeController _meController;
  late final ProfileController _profileController;
}
