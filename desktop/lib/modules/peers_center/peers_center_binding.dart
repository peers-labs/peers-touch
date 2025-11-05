import 'package:get/get.dart';
import 'peers_center_controller.dart';

class PeersCenterBinding implements Bindings {
  @override
  void dependencies() => Get.lazyPut<PeersCenterController>(() => PeersCenterController());
}