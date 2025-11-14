import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/ai_chat/controller/ai_chat_controller.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';

class AIChatBinding extends Bindings {
  @override
  void dependencies() {
    if (!Get.isRegistered<AIChatController>()) {
      Get.lazyPut<AIChatController>(() {
        final storage = Get.find<StorageService>();
        final provider = storage.get<String>('ai_provider_type') ?? 'OpenAI';
        final service = AIServiceFactory.fromName(provider);
        return AIChatController(
          service: service,
          storage: storage,
        );
      }, fenix: true);
    }
  }
}