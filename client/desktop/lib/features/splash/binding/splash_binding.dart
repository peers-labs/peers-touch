import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/splash/controller/splash_controller.dart';

class SplashBinding extends Bindings {
  @override
  void dependencies() {
    Get.put(SplashController());
  }
}
