import 'package:get/get.dart';

/// 封装存储层的依赖注册，确保可幂等调用
class StorageServiceModule {
  static void register() {
    // 基础存储（若 InitialBinding 已注册则跳过）
    if (!Get.isRegistered<StorageService>()) {
      Get.put<StorageService>(StorageService(), permanent: true);
    }
    if (!Get.isRegistered<SecureStorageService>()) {
      Get.put<SecureStorageService>(SecureStorageService(), permanent: true);
    }

    // 本地缓存与路由解析
    if (!Get.isRegistered<StorageServiceCache>()) {
      Get.put<StorageServiceCache>(StorageServiceCache(), permanent: true);
    }
    if (!Get.isRegistered<RouteProvider>()) {
      Get.put<RouteProvider>(ConventionalRouteProvider(), permanent: true);
    }

    // 存储驱动与服务
    if (!Get.isRegistered<StorageServiceDriver>()) {
      Get.put<StorageServiceDriver>(HttpStorageServiceDriver(), permanent: true);
    }
    if (!Get.isRegistered<HybridStorageService>()) {
      Get.put<HybridStorageService>(HybridStorageService(), permanent: true);
    }
  }
}