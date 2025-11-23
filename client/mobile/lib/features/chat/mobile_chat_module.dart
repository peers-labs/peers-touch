import 'package:get/get.dart';

import '../bindings/mobile_chat_binding.dart';
import '../pages/mobile_chat_page.dart';

/// 移动端聊天模块
/// 负责模块注册和路由配置
class MobileChatModule {
  static const String routeName = '/chat';
  static const String sessionRouteName = '/chat/session';
  
  static void register() {
    // 注册依赖绑定
    Get.put(MobileChatBinding());
    
    // 配置路由
    GetPage(
      name: routeName,
      page: () => const MobileChatPage(),
      binding: MobileChatBinding(),
    );
    
    // 聊天会话页面路由
    GetPage(
      name: sessionRouteName,
      page: () => _buildChatSessionPage(),
      binding: MobileChatBinding(),
    );
  }
  
  static void unregister() {
    // 清理依赖
    if (Get.isRegistered<MobileChatBinding>()) {
      Get.delete<MobileChatBinding>();
    }
  }
  
  /// 构建聊天会话页面
  static Widget _buildChatSessionPage() {
    final arguments = Get.arguments as Map<String, dynamic>?;
    final session = arguments?['session'] as ChatSession?;
    final friend = arguments?['friend'] as Friend?;
    
    if (session == null || friend == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('聊天')),
        body: const Center(child: Text('无效参数')),
      );
    }
    
    // 返回移动端聊天会话页面
    return _MobileChatSessionPage(session: session, friend: friend);
  }
}

/// 移动端聊天会话页面
class _MobileChatSessionPage extends StatelessWidget {
  final ChatSession session;
  final Friend friend;
  
  const _MobileChatSessionPage({
    required this.session,
    required this.friend,
  });
  
  @override
  Widget build(BuildContext context) {
    final controller = Get.find<MobileChatController>();
    
    // 设置当前会话和好友
    controller.selectedSession.value = session;
    controller.selectedFriend.value = friend;
    controller.loadSessionMessages(session.id);
    controller.markMessagesAsRead();
    
    return controller._buildChatSessionPage(session, friend);
  }
}