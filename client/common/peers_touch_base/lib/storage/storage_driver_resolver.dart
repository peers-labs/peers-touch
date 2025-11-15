import 'package:get/get.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';

enum StorageMode { local, cloud, hybrid }

/// 根据设置选择当前存储驱动
class StorageDriverResolver {
  final LocalStorage _localStorage = Get.find<LocalStorage>();

  StorageMode get currentMode {
    final v = _localStorage.get<String>('settings:storage:mode')?.toLowerCase() ?? 'hybrid';
    switch (v) {
      case 'local':
        return StorageMode.local;
      case 'cloud':
        return StorageMode.cloud;
      default:
        return StorageMode.hybrid;
    }
  }

  bool get isCloudEnabled => currentMode != StorageMode.local;

  StorageDriver currentDriver() {
    switch (currentMode) {
      case StorageMode.local:
        return Get.find<LocalStorageDriver>();
      case StorageMode.cloud:
        return Get.find<HttpStorageDriver>();
      case StorageMode.hybrid:
        return Get.find<HttpStorageDriver>();
    }
  }
}