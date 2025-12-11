import 'package:get/get.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_facade_service.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_mode.dart';

import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/provider_service.dart';

import '../controller/provider_controller.dart';

class AIChatBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<AiBoxFacadeService>(
      () => AiBoxFacadeService(mode: AiBoxMode.local),
      fenix: true,
    );
    Get.lazyPut<ProviderService>(() => ProviderService(), fenix: true);
    Get.lazyPut<ProviderController>(() => ProviderController(), fenix: true);

    if (!Get.isRegistered<AIChatController>()) {
      Get.put<AIChatController>(
        AIChatController(
          storage: Get.find<LocalStorage>(),
        ),
        permanent: true,
      );
    }
  }
}
