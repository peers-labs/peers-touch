import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/chat/application/backends/social_backend_adapter.dart';
import 'package:peers_touch_desktop/features/chat/application/services/chat_service.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_list_controller.dart';
import 'package:peers_touch_desktop/features/chat/controller/chat_thread_controller.dart';
import 'package:peers_touch_desktop/features/chat/controller/friend_search_controller.dart';

class ChatBinding extends Bindings {
  @override
  void dependencies() {
    if (!Get.isRegistered<ChatService>()) {
      Get.lazyPut<ChatService>(() {
        final adapter = SocialBackendAdapter(baseUrl: '');
        return ChatService(backend: adapter);
      }, fenix: true);
    }
    if (!Get.isRegistered<ChatListController>()) {
      Get.lazyPut<ChatListController>(() => ChatListController(service: Get.find<ChatService>()), fenix: true);
    }
    if (!Get.isRegistered<ChatThreadController>()) {
      Get.lazyPut<ChatThreadController>(() => ChatThreadController(service: Get.find<ChatService>()), fenix: true);
    }
    if (!Get.isRegistered<FriendSearchController>()) {
      Get.lazyPut<FriendSearchController>(() => FriendSearchController(service: Get.find<ChatService>()), fenix: true);
    }
  }
}