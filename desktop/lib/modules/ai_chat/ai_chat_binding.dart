import 'package:get/get.dart';
import 'ai_chat_controller.dart';

class AiChatBinding implements Bindings {
  @override
  void dependencies() => Get.lazyPut<AiChatController>(() => AiChatController());
}