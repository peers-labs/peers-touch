import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/services/setting_manager.dart';
import 'package:peers_touch_desktop/features/settings/controller/setting_controller.dart';

class SettingsBinding extends Bindings {
  @override
  void dependencies() {
    // Ensure global SettingManager is available before any module tries to find it
    if (!Get.isRegistered<SettingManager>()) {
      Get.put<SettingManager>(SettingManager(), permanent: true);
    }
    if (!Get.isRegistered<SettingController>()) {
      Get.lazyPut<SettingController>(() => SettingController(), fenix: true);
    }
    
    // 保持仅使用自定义页面分区“AI 服务商”，不额外注入 items 分区
  }
}
