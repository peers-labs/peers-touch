import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/chat/chat.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pbenum.dart';
import 'package:peers_touch_base/model/domain/core/core.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_mobile/features/chat/controllers/mobile_chat_controller.dart';

/// 移动端聊天主页面
/// 采用列表导航模式，好友列表和聊天分离
class MobileChatPage extends GetView<MobileChatController> {
  const MobileChatPage({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('消息'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => _showSearchDialog(),
          ),
          PopupMenuButton<String>(
            onSelected: (value) {
              switch (value) {
                case 'add_friend':
                  _showAddFriendDialog();
                  break;
                case 'register_network':
                  _showRegisterDialog();
                  break;
                case 'join_session':
                  _showJoinSessionDialog();
                  break;
                case 'clear_data':
                  _showClearDataDialog();
                  break;
              }
            },
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: 'add_friend',
                child: Text('添加好友'),
              ),
              const PopupMenuItem(
                value: 'register_network',
                child: Text('注册网络'),
              ),
              const PopupMenuItem(
                value: 'join_session',
                child: Text('加入会话'),
              ),
              const PopupMenuItem(
                value: 'clear_data',
                child: Text('清理数据'),
              ),
            ],
          ),
        ],
      ),
      body: Obx(() {
        if (controller.isLoading.value) {
          return const Center(child: CircularProgressIndicator());
        }
        
        if (controller.sessions.isEmpty) {
          return _buildEmptyView();
        }
        
        return _buildSessionList();
      }),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddFriendDialog(),
        tooltip: '添加好友',
        child: const Icon(Icons.person_add),
      ),
    );
  }

  void _showRegisterDialog() {
    final urlController = TextEditingController(text: controller.signalingUrl.value);
    final idController = TextEditingController(text: controller.selfPeerId.value);
    final roleController = TextEditingController(text: controller.selfRole.value);
    final addrsController = TextEditingController(text: controller.selfAddrs.join(','));
    Get.defaultDialog(
      title: '注册网络',
      content: Column(
        children: [
          TextField(controller: urlController, decoration: const InputDecoration(labelText: '信令URL')), 
          TextField(controller: idController, decoration: const InputDecoration(labelText: '自身PeerId')),
          TextField(controller: roleController, decoration: const InputDecoration(labelText: '角色(mobile/desktop)')),
          TextField(controller: addrsController, decoration: const InputDecoration(labelText: 'Addrs(逗号分隔)')),
        ],
      ),
      textConfirm: '注册',
      onConfirm: () {
        controller.signalingUrl.value = urlController.text;
        controller.selfPeerId.value = idController.text;
        controller.selfRole.value = roleController.text;
        controller.selfAddrs.assignAll(addrsController.text.split(',').where((e)=>e.trim().isNotEmpty));
        controller.registerNetwork();
        Get.back();
      },
      textCancel: '取消',
    );
  }

  void _showJoinSessionDialog() {
    final peerIdController = TextEditingController();
    Get.defaultDialog(
      title: '加入会话 (Connect)',
      content: TextField(
        controller: peerIdController,
        decoration: const InputDecoration(labelText: '对方PeerId'),
      ),
      textConfirm: '连接',
      onConfirm: () {
        controller.joinSession(peerIdController.text);
        Get.back();
      },
      textCancel: '取消',
    );
  }

  /// 构建空视图
  Widget _buildEmptyView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.chat_bubble_outline,
            size: 80,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 16),
          Text(
            '暂无聊天记录',
            style: TextStyle(
              fontSize: 18,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '点击右下角添加好友开始聊天',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[500],
            ),
          ),
        ],
      ),
    );
  }

  /// 构建会话列表
  Widget _buildSessionList() {
    return ListView.builder(
      itemCount: controller.sessions.length,
      itemBuilder: (context, index) {
        final session = controller.sessions[index];
        return _buildSessionItem(session);
      },
    );
  }

  /// 构建会话项
  Widget _buildSessionItem(ChatSession session) {
    // 获取会话的另一个参与者（假设只有两个参与者）
    final otherParticipantId = session.participantIds.firstWhere(
      (id) => id != controller.selfPeerId.value, // Use controller's peerId
      orElse: () => session.participantIds.isNotEmpty ? session.participantIds.first : 'unknown',
    );
    
    // 根据参与者ID获取好友信息
    final friend = controller.friends.firstWhere(
      (f) => f.user.id == otherParticipantId,
      orElse: () => Friend(
        user: Actor(
            id: otherParticipantId,
            name: otherParticipantId,
            displayName: otherParticipantId,
        ),
        status: FriendshipStatus.FRIENDSHIP_STATUS_ACCEPTED,
        friendshipCreatedAt: Timestamp.fromDateTime(DateTime.now()),
      ),
    );
    
    return InkWell(
      onTap: () => _openChatSession(session, friend),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: Colors.grey[200]!)),
        ),
        child: Row(
          children: [
            // 头像
            Stack(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: Colors.blue[100],
                  child: Text(
                    friend.user.name.isNotEmpty ? friend.user.name[0].toUpperCase() : '?',
                    style: TextStyle(
                      color: Colors.blue[700],
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                
                // 在线状态指示器 (Assuming false or checking metadata if available)
                // if (friend.isOnline) ...
              ],
            ),
            
            const SizedBox(width: 12),
            
            // 信息区域
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                      child: Text(
                          friend.user.name,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      
                      // 未读数
                      if (session.unreadCount > 0)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.red,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            session.unreadCount.toString(),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                    ],
                  ),
                  
                  const SizedBox(height: 4),
                  
                  // 最后消息
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          session.lastMessageSnippet.isNotEmpty ? session.lastMessageSnippet : '暂无消息',
                          style: TextStyle(
                            fontSize: 14,
                            color: session.unreadCount > 0 ? Colors.black87 : Colors.grey[600],
                            fontWeight: session.unreadCount > 0 ? FontWeight.w500 : FontWeight.normal,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      
                      Text(
                        _formatTime(session.lastMessageAt),
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.grey[500],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// 构建好友列表页面（用于选择好友开始聊天）
  // ignore: unused_element
  Widget _buildFriendListPage() {
    return Scaffold(
      appBar: AppBar(
        title: const Text('选择好友'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => _showSearchDialog(),
          ),
        ],
      ),
      body: Obx(() {
        if (controller.isLoading.value) {
          return const Center(child: CircularProgressIndicator());
        }
        
        if (controller.friends.isEmpty) {
          return _buildEmptyFriendView();
        }
        
        return _buildFriendList();
      }),
    );
  }

  /// 构建空好友视图
  Widget _buildEmptyFriendView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.people_outline,
            size: 80,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 16),
          Text(
            '暂无好友',
            style: TextStyle(
              fontSize: 18,
              color: Colors.grey[600],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '点击右上角添加好友',
            style: TextStyle(
              fontSize: 14,
              color: Colors.grey[500],
            ),
          ),
        ],
      ),
    );
  }

  /// 构建好友列表
  Widget _buildFriendList() {
    final friends = controller.searchResults;
    
    return ListView.builder(
      itemCount: friends.length,
      itemBuilder: (context, index) {
        final friend = friends[index];
        return _buildFriendItem(friend);
      },
    );
  }

  /// 构建好友项
  Widget _buildFriendItem(Friend friend) {
    return InkWell(
      onTap: () => controller.selectFriend(friend),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: BoxDecoration(
          border: Border(bottom: BorderSide(color: Colors.grey[200]!)),
        ),
        child: Row(
          children: [
            // 头像
            Stack(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: Colors.blue[100],
                  child: Text(
                    friend.user.name.isNotEmpty ? friend.user.name[0].toUpperCase() : '?',
                    style: TextStyle(
                      color: Colors.blue[700],
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                
                // 在线状态指示器
                // if (friend.isOnline) ...
              ],
            ),
            
            const SizedBox(width: 12),
            
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    friend.user.name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  // const SizedBox(height: 4),
                  // Text(
                  //   friend.isOnline ? '在线' : '离线',
                  //   style: TextStyle(
                  //     fontSize: 12,
                  //     color: friend.isOnline ? Colors.green : Colors.grey,
                  //   ),
                  // ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
  
  void _showAddFriendDialog() {
    final idController = TextEditingController();
    final msgController = TextEditingController();
    Get.defaultDialog(
      title: '添加好友',
      content: Column(
        children: [
          TextField(
            controller: idController,
            decoration: const InputDecoration(labelText: '用户ID'),
          ),
          TextField(
            controller: msgController,
            decoration: const InputDecoration(labelText: '验证消息'),
          ),
        ],
      ),
      textConfirm: '发送请求',
      onConfirm: () {
        if (idController.text.isNotEmpty) {
          controller.addFriend(idController.text, message: msgController.text);
          Get.back();
        }
      },
      textCancel: '取消',
    );
  }
  
  void _showSearchDialog() {
    final searchController = TextEditingController();
    Get.defaultDialog(
      title: '搜索',
      content: TextField(
        controller: searchController,
        decoration: const InputDecoration(labelText: '搜索好友或消息'),
        onChanged: (val) => controller.searchQuery.value = val,
      ),
      textConfirm: '确定',
      onConfirm: () => Get.back(),
    );
  }
  
  void _showClearDataDialog() {
    Get.defaultDialog(
      title: '清理数据',
      middleText: '确定要清理所有本地数据吗？',
      textConfirm: '清理',
      onConfirm: () {
        // controller.clearData(); // Implement clearData in controller if needed
        Get.back();
      },
      textCancel: '取消',
    );
  }

  void _openChatSession(ChatSession session, Friend friend) {
    Get.toNamed('/chat/session', arguments: {
      'friend': friend,
      'session': session,
    });
  }

  String _formatTime(Timestamp? timestamp) {
    if (timestamp == null) return '';
    final dt = timestamp.toDateTime();
    final now = DateTime.now();
    if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
      return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    }
    return '${dt.month}/${dt.day}';
  }
}
