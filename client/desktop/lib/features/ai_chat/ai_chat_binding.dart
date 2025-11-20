import 'package:get/get.dart';

import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';

import 'controller/provider_controller.dart';

class AIChatBinding extends Bindings {
  @override
  void dependencies() {
    if (!Get.isRegistered<AIChatController>()) {
      Get.put<AIChatController>(
        AIChatController(
          service: AIServiceFactory.fromName(
            Get.find<LocalStorage>().get<String>('ai_provider_type') ??
                'OpenAI',
          ),
          storage: Get.find<LocalStorage>(),
        ),
        permanent: true,
      );
    }

    if (!Get.isRegistered<ProviderController>()) {
      Get.put(ProviderController());
    }
  }
}
