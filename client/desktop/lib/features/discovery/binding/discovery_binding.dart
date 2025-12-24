import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/discovery/controller/activity_controller.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';

class DiscoveryBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<DiscoveryRepository>(() => DiscoveryRepository());
    Get.lazyPut<DiscoveryController>(() => DiscoveryController());
    Get.lazyPut<ActivityController>(() => ActivityController());
  }
}
