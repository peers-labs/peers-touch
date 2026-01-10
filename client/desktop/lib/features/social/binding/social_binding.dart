import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/social/controller/timeline_controller.dart';

class SocialBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<TimelineController>(() => TimelineController());
  }
}
