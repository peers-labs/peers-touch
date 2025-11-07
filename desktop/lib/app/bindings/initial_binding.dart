import 'package:get/get.dart';

import '../../core/network/api_client.dart';
import '../../core/network/network_status_service.dart';
import '../../core/storage/local_storage.dart';
import '../../core/storage/secure_storage.dart';
import '../../features/shared/services/user_status_service.dart';

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