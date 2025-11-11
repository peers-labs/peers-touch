import 'package:get/get.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';
import 'package:peers_touch_desktop/core/storage/storage_service.dart';

/// 封装存储层的依赖注册，确保可幂等调用
class StorageModule {
  static void register() {
    // 基础存储（若 InitialBinding 已注册则跳过）
    if (!Get.isRegistered<LocalStorage>()) {
      Get.put<LocalStorage>(LocalStorage(), permanent: true);
    }
    if (!Get.isRegistered<SecureStorage>()) {
      Get.put<SecureStorage>(SecureStorage(), permanent: true);
    }

    // 本地缓存与路由解析
    if (!Get.isRegistered<StorageCache>()) {
      Get.put<StorageCache>(StorageCache(), permanent: true);
    }
    if (!Get.isRegistered<RouteProvider>()) {
      Get.put<RouteProvider>(ConventionalRouteProvider(), permanent: true);
    }

    // 存储驱动与服务
    if (!Get.isRegistered<StorageDriver>()) {
      Get.put<StorageDriver>(HttpStorageDriver(), permanent: true);
    }
    if (!Get.isRegistered<StorageService>()) {
      Get.put<StorageService>(StorageService(), permanent: true);
    }
  }
}