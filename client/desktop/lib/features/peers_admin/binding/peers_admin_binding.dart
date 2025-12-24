import 'package:get/get.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_desktop/features/peers_admin/controller/peers_admin_controller.dart';

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