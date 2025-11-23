import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/core/services/network_discovery/libp2p_network_service.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/core/storage/secure_storage.dart';
import 'package:peers_touch_desktop/features/peers_admin/controller/peers_admin_controller.dart';

class PeersAdminBinding extends Bindings {
  @override
  void dependencies() {
    if (!Get.isRegistered<PeersAdminController>()) {
      Get.lazyPut<PeersAdminController>(() {
        return PeersAdminController(
          apiClient: Get.find<ApiClient>(),
          localStorage: Get.find<LocalStorage>(),
          secureStorage: Get.find<SecureStorage>(),
          libp2pNetworkService: Get.find<Libp2pNetworkService>(),
        );
      }, fenix: true);
    }
  }
}