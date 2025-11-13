import 'package:get/get.dart';

import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/core/network/network_status_service.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';
import 'package:peers_touch_desktop/core/storage/storage_service.dart';
import 'package:peers_touch_desktop/features/shared/services/user_status_service.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';

/// Application dependency injection binding
/// Focuses on GetX dependency injection registration and management
class InitialBinding extends Bindings {
  @override
  void dependencies() {
    _registerStorageServices();
    _registerNetworkServices();
    _registerBusinessServices();
  }
  
  /// Register storage services
  void _registerStorageServices() {
    Get.put<LocalStorage>(LocalStorage(), permanent: true);
    Get.put<SecureStorage>(SecureStorage(), permanent: true);

    // 路由解析与本地缓存
    Get.put<RouteProvider>(ConventionalRouteProvider(), permanent: true);
    Get.put<StorageCache>(StorageCache(), permanent: true);

    // 存储驱动与服务（插件化：同时注册本地与云端驱动，由 Resolver 选择）
    Get.put<HttpStorageDriver>(HttpStorageDriver(), permanent: true);
    Get.put<LocalStorageDriver>(LocalStorageDriver(), permanent: true);
    Get.put<StorageDriverResolver>(StorageDriverResolver(), permanent: true);
    Get.put<StorageSyncService>(StorageSyncService(), permanent: true);
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
    Get.put<ProviderService>(ProviderService(), permanent: true);
  }
}