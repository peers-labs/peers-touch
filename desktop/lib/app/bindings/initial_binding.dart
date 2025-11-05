import 'package:get/get.dart';

import '../../core/network/api_client.dart';
import '../../core/network/network_status_service.dart';
import '../../core/storage/local_storage.dart';
import '../../core/storage/secure_storage.dart';
import '../../features/shared/services/user_status_service.dart';

class InitialBinding extends Bindings {
  @override
  void dependencies() {
    Get.put<LocalStorage>(LocalStorage(), permanent: true);
    Get.put<SecureStorage>(SecureStorage(), permanent: true);
    Get.put<NetworkStatusService>(NetworkStatusService(), permanent: true);
    Get.put<ApiClient>(
      ApiClient(
        secureStorage: Get.find<SecureStorage>(),
        networkStatusService: Get.find<NetworkStatusService>(),
        // tokenRefreshHandler: null, // 可在接入真实刷新接口后注入
      ),
      permanent: true,
    );
    Get.put<UserStatusService>(UserStatusService(), permanent: true);
  }
}