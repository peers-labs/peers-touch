import 'package:get/get.dart';
import 'package:peers_touch_base/storage.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/features/peers_admin/peers_admin_controller.dart';

class PeersAdminBinding extends Bindings {
  @override
  void dependencies() {
    if (!Get.isRegistered<PeersAdminController>()) {
      Get.lazyPut<PeersAdminController>(() {
        return PeersAdminController(
          apiClient: Get.find<ApiClient>(),
          localStorageService: Get.find<StorageService>(),
          secureStorageService: Get.find<SecureStorageService>(),
        );
      }, fenix: true);
    }
  }
}