import 'package:get/get.dart';
import 'local_storage.dart';
import 'drivers/in_memory_driver.dart';
import 'drivers/local_storage_driver.dart';
import 'drivers/http_storage_driver.dart';

enum StorageMode { local, cloud, hybrid }

/// Resolve current storage driver based on local settings.
class StorageDriverResolver {
  final StorageService _localStorage = Get.find<StorageService>();

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
        // Prefer persistent local driver; fallback to in-memory if not registered
        if (Get.isRegistered<StorageServiceDriver>()) return Get.find<StorageServiceDriver>();
        return InMemoryStorageDriver();
      case StorageMode.cloud:
        return Get.find<HttpStorageDriver>();
      case StorageMode.hybrid:
        return Get.find<HttpStorageDriver>();
    }
  }
}