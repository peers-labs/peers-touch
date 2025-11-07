import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';

class SettingsBinding extends Bindings {
  @override
  void dependencies() {
    if (!Get.isRegistered<SettingController>()) {
      Get.lazyPut<SettingController>(() => SettingController(), fenix: true);
    }
  }
}