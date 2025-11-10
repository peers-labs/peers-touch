import 'package:get/get.dart';

import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/core/network/network_status_service.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart';
import 'package:peers_touch_desktop/core/storage/storage_cache.dart';
import 'package:peers_touch_desktop/core/storage/storage_route_provider.dart';
import 'package:peers_touch_desktop/core/storage/storage_driver.dart';
import 'package:peers_touch_desktop/core/storage/http_storage_driver.dart';
import 'package:peers_touch_desktop/core/storage/storage_service.dart';
import 'package:peers_touch_desktop/features/shared/services/user_status_service.dart';

/// Application dependency injection binding
/// Focuses on GetX dependency injection registration and management
class InitialBinding extends Bindings {
  @override
  void dependencies() {
    _registerNetworkServices();
    _registerStorageServices();
    _registerBusinessServices();
  }
  
  /// Register storage services
  void _registerStorageServices() {
    Get.put<LocalStorage>(LocalStorage(), permanent: true);
    Get.put<SecureStorage>(SecureStorage(), permanent: true);

    // 路由解析与本地缓存
    Get.put<RouteProvider>(ConventionalRouteProvider(), permanent: true);
    Get.put<StorageCache>(StorageCache(), permanent: true);

    // 存储驱动与服务
    Get.put<StorageDriver>(HttpStorageDriver(), permanent: true);
    Get.put<StorageService>(StorageService(), permanent: true);
  }
  
  /// Register network services
  void _registerNetworkServices() {
    Get.put<NetworkStatusService>(NetworkStatusService(), permanent: true);
    Get.put<ApiClient>(
      ApiClient(
        secureStorage: Get.find<SecureStorage>(),
        networkStatusService: Get.find<NetworkStatusService>(),
        // tokenRefreshHandler: null, // Can be injected when real refresh interface is connected
      ),
      permanent: true,
    );
  }
  
  /// Register business services
  void _registerBusinessServices() {
    Get.put<UserStatusService>(UserStatusService(), permanent: true);
  }
}