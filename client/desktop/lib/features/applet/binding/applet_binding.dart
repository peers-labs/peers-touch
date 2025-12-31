import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/applet/controller/market_controller.dart';

class AppletBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<MarketController>(() => MarketController());
  }
}
