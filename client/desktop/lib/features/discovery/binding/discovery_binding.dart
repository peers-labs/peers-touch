import 'package:get/get.dart';
import '../controller/discovery_controller.dart';

class DiscoveryBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<DiscoveryController>(() => DiscoveryController());
  }
}
