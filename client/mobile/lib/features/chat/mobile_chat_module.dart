import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';

import 'controllers/mobile_chat_controller.dart';
import 'bindings/mobile_chat_binding.dart';
import 'pages/mobile_chat_page.dart';

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
class _MobileChatSessionPage extends StatefulWidget {
  final ChatSession session;
  final Friend friend;
  
  const _MobileChatSessionPage({
    required this.session,
    required this.friend,
  });

  @override
  State<_MobileChatSessionPage> createState() => _MobileChatSessionPageState();
}

class _MobileChatSessionPageState extends State<_MobileChatSessionPage> {
  final TextEditingController _textController = TextEditingController();
  late MobileChatController controller;

  @override
  void initState() {
    super.initState();
    controller = Get.find<MobileChatController>();
    
    // 设置当前会话和好友
    WidgetsBinding.instance.addPostFrameCallback((_) {
      controller.selectedSession.value = widget.session;
      controller.selectedFriend.value = widget.friend;
      controller.loadSessionMessages(widget.session.id);
      controller.markMessagesAsRead();
    });
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.friend.user.displayName.isNotEmpty 
            ? widget.friend.user.displayName 
            : widget.friend.user.name),
      ),
      body: Column(
        children: [
          Expanded(
            child: Obx(() {
              final messages = controller.messages;
              return ListView.builder(
                reverse: true,
                itemCount: messages.length,
                itemBuilder: (context, index) {
                  final msg = messages[messages.length - 1 - index];
                  final isMe = msg.senderId == controller.selfPeerId.value;
                  return Align(
                    alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: isMe ? Colors.blue[100] : Colors.grey[200],
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(msg.content),
                          const SizedBox(height: 4),
                          Text(
                            msg.sentAt.toString(), // TODO: Format time
                            style: TextStyle(fontSize: 10, color: Colors.grey[600]),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              );
            }),
          ),
          Container(
            padding: const EdgeInsets.all(8.0),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.grey.withValues(alpha: 0.2),
                  spreadRadius: 1,
                  blurRadius: 5,
                ),
              ],
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _textController,
                    onChanged: (val) => controller.currentMessage.value = val,
                    decoration: const InputDecoration(
                      hintText: 'Type a message...',
                      border: InputBorder.none,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.send, color: Colors.blue),
                  onPressed: () {
                    if (controller.currentMessage.value.trim().isNotEmpty) {
                      controller.sendMessage();
                      _textController.clear();
                    }
                  },
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
