import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:get/get.dart';
import '../controller/peers_admin_controller.dart';

class PeersAdminBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<PeersAdminController>(() => PeersAdminController(
      httpService: HttpServiceLocator().httpService,
      localStorage: Get.find(),
      secureStorage: Get.find(),
      libp2pNetworkService: Get.find(),
    ));
  }
}