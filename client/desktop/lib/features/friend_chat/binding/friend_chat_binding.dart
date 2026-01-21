import 'package:get/get.dart';
import 'package:peers_touch_desktop/features/friend_chat/controller/friend_chat_controller.dart';

class FriendChatBinding extends Bindings {
  @override
  void dependencies() {
    Get.lazyPut<FriendChatController>(() => FriendChatController(), fenix: true);
  }
}
