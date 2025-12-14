import 'package:get/get.dart';
import '../controller/discovery_controller.dart';
import '../controller/posting_controller.dart';
import '../repository/discovery_repository.dart';

class DiscoveryBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<DiscoveryRepository>(() => DiscoveryRepository());
    Get.lazyPut<DiscoveryController>(() => DiscoveryController());
    Get.lazyPut<PostingController>(() => PostingController());
  }
}
