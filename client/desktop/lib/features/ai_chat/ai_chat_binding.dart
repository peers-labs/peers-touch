import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_proxy_controller.dart';

class AIChatBinding extends Bindings {
  @override
  void dependencies() {
    if (!Get.isRegistered<AIChatProxyController>()) {
      Get.put<AIChatProxyController>(
        AIChatProxyController(),
        permanent: true,
      );
    }
  }
}