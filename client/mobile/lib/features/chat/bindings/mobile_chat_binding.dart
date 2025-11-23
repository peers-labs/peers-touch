import 'package:get/get.dart';
import 'package:peers_touch_base/chat/chat.dart';

import '../controllers/mobile_chat_controller.dart';

/// 移动端聊天模块绑定
/// 负责依赖注入和控制器初始化
class MobileChatBinding implements Bindings {
  @override
  void dependencies() {
    // 注册核心服务
    Get.lazyPut<ChatCoreService>(() => ChatCoreServiceImpl(
      Get.find(),
      Get.find(),
      Get.find(),
    ));
    
    // 注册移动端控制器
    Get.lazyPut<MobileChatController>(() => MobileChatController(
      Get.find<ChatCoreService>(),
    ));
  }
}