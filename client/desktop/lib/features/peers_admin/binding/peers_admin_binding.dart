import 'package:get/get.dart';
import '../controller/peers_admin_controller.dart';

class PeersAdminBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<PeersAdminController>(() => PeersAdminController(
      apiClient: Get.find(),
      localStorage: Get.find(),
      secureStorage: Get.find(),
      libp2pNetworkService: Get.find(),
    ));
  }
}