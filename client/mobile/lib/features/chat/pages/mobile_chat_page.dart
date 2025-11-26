import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/chat/chat.dart';

import '../controllers/mobile_chat_controller.dart';

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
        child: const Icon(Icons.person_add),
        tooltip: '添加好友',
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
      (id) => id != 'current_user_id', // 需要获取当前用户ID
      orElse: () => session.participantIds.first,
    );
    
    // 根据参与者ID获取好友信息
    final friend = controller.friends.firstWhere(
      (f) => f.id == otherParticipantId,
      orElse: () => Friend(
        id: otherParticipantId,
        name: otherParticipantId,
        peerId: otherParticipantId,
        status: FriendshipStatus.ACCEPTED,
        isOnline: false,
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
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
                    friend.name.isNotEmpty ? friend.name[0].toUpperCase() : '?',
                    style: TextStyle(
                      color: Colors.blue[700],
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                
                // 在线状态指示器
                if (friend.isOnline)
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                  ),
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
                          friend.name,
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
                          session.lastMessage?.content ?? '暂无消息',
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
                        _formatTime(session.updatedAt),
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
                    friend.name.isNotEmpty ? friend.name[0].toUpperCase() : '?',
                    style: TextStyle(
                      color: Colors.blue[700],
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                
                // 在线状态
                if (friend.isOnline)
                  Positioned(
                    right: 0,
                    bottom: 0,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: Colors.green,
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 2),
                      ),
                    ),
                  ),
              ],
            ),
            
            const SizedBox(width: 12),
            
            // 信息
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    friend.name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    friend.isOnline ? '在线' : '离线',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.grey[600],
                    ),
                  ),
                ],
              ),
            ),
            
            // 状态图标
            Icon(
              Icons.message,
              color: Colors.grey[400],
              size: 20,
            ),
          ],
        ),
      ),
    );
  }

  /// 构建聊天会话页面
  Widget _buildChatSessionPage(ChatSession session, Friend friend) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: Colors.blue[100],
              child: Text(
                friend.name.isNotEmpty ? friend.name[0].toUpperCase() : '?',
                style: TextStyle(
                  color: Colors.blue[700],
                  fontSize: 14,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    friend.name,
                    style: const TextStyle(fontSize: 16),
                  ),
                  Text(
                    friend.isOnline ? '在线' : '离线',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.white70,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_vert),
            onPressed: () => _showChatOptions(friend),
          ),
        ],
      ),
      body: Column(
        children: [
          // 消息列表
          Expanded(
            child: Obx(() {
              if (controller.messages.isEmpty) {
                return _buildEmptyChatView();
              }
              return _buildMessageList();
            }),
          ),
          
          // 输入区域
          _buildInputArea(),
        ],
      ),
    );
  }

  /// 构建空聊天视图
  Widget _buildEmptyChatView() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.chat_bubble_outline,
            size: 64,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 16),
          Text(
            '开始对话',
            style: TextStyle(
              fontSize: 16,
              color: Colors.grey[600],
            ),
          ),
        ],
      ),
    );
  }

  /// 构建消息列表
  Widget _buildMessageList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      reverse: true, // 移动端通常最新消息在底部
      itemCount: controller.messages.length,
      itemBuilder: (context, index) {
        final message = controller.messages[controller.messages.length - 1 - index];
        return _buildMessageItem(message);
      },
    );
  }

  /// 构建消息项
  Widget _buildMessageItem(ChatMessage message) {
    final isCurrentUser = message.senderId == 'current_user_id'; // 需要获取当前用户ID
    
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: isCurrentUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          if (!isCurrentUser) ...[
            CircleAvatar(
              radius: 16,
              backgroundColor: Colors.blue[100],
              child: Text(
                message.senderId[0].toUpperCase(),
                style: TextStyle(
                  color: Colors.blue[700],
                  fontSize: 12,
                ),
              ),
            ),
            const SizedBox(width: 8),
          ],
          
          Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.7,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: isCurrentUser ? Theme.of(context).primaryColor : Colors.grey[200],
              borderRadius: BorderRadius.circular(18).copyWith(
                topLeft: isCurrentUser ? const Radius.circular(18) : Radius.zero,
                topRight: !isCurrentUser ? const Radius.circular(18) : Radius.zero,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  message.content,
                  style: TextStyle(
                    color: isCurrentUser ? Colors.white : Colors.black87,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _formatMessageTime(message.sentAt),
                  style: TextStyle(
                    color: isCurrentUser ? Colors.white70 : Colors.grey[600],
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          
          if (isCurrentUser) ...[
            const SizedBox(width: 8),
            Icon(
              message.status == MessageStatus.SENT ? Icons.check : Icons.check_circle,
              size: 16,
              color: Colors.grey[400],
            ),
          ],
        ],
      ),
    );
  }

  /// 构建输入区域
  Widget _buildInputArea() {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey[300]!)),
      ),
      child: Row(
        children: [
          // 语音按钮
          IconButton(
            icon: const Icon(Icons.mic_none),
            onPressed: () => controller.startVoiceInput(),
            color: Colors.grey[600],
          ),
          
          // 更多选项
          IconButton(
            icon: const Icon(Icons.add_circle_outline),
            onPressed: () => _showMoreOptions(),
            color: Colors.grey[600],
          ),
          
          // 输入框
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: Colors.grey[100],
                borderRadius: BorderRadius.circular(24),
              ),
              child: TextField(
                controller: TextEditingController(text: controller.currentMessage.value),
                decoration: const InputDecoration(
                  hintText: '输入消息...',
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(vertical: 12),
                ),
                maxLines: null,
                textInputAction: TextInputAction.send,
                onChanged: (value) => controller.currentMessage.value = value,
                onSubmitted: (_) => controller.sendMessage(),
              ),
            ),
          ),
          
          const SizedBox(width: 8),
          
          // 发送按钮
          Obx(() => IconButton(
            icon: controller.isSending.value
                ? const SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.send),
            onPressed: controller.isSending.value ? null : () => controller.sendMessage(),
            color: Theme.of(context).primaryColor,
            iconSize: 28,
          )),
        ],
      ),
    );
  }

  // ==================== 辅助方法 ====================

  String _formatTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);
    
    if (diff.inDays > 0) {
      return '${diff.inDays}天前';
    } else if (diff.inHours > 0) {
      return '${diff.inHours}小时前';
    } else if (diff.inMinutes > 0) {
      return '${diff.inMinutes}分钟前';
    } else {
      return '刚刚';
    }
  }

  String _formatMessageTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);
    
    if (diff.inDays > 0) {
      return '${diff.inDays}天前';
    } else if (diff.inHours > 0) {
      return '${diff.inHours}小时前';
    } else if (diff.inMinutes > 0) {
      return '${diff.inMinutes}分钟前';
    } else {
      return '刚刚';
    }
  }

  // ==================== 交互方法 ====================

  void _openChatSession(ChatSession session, Friend friend) {
    // 加载会话消息
    controller.loadSessionMessages(session.id);
    controller.selectedSession.value = session;
    controller.selectedFriend.value = friend;
    
    // 导航到聊天页面
    Get.to(() => _buildChatSessionPage(session, friend));
  }

  void _showSearchDialog() {
    final searchController = TextEditingController();
    
    Get.dialog(
      AlertDialog(
        title: const Text('搜索'),
        content: TextField(
          controller: searchController,
          decoration: const InputDecoration(
            hintText: '输入好友名称或ID',
            prefixIcon: Icon(Icons.search),
          ),
          autofocus: true,
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () {
              controller.searchQuery.value = searchController.text;
              Get.back();
            },
            child: const Text('搜索'),
          ),
        ],
      ),
    );
  }

  void _showAddFriendDialog() {
    final peerIdController = TextEditingController();
    final messageController = TextEditingController();
    
    Get.dialog(
      AlertDialog(
        title: const Text('添加好友'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: peerIdController,
              decoration: const InputDecoration(
                labelText: '对方ID',
                hintText: '输入对方的Peer ID',
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: messageController,
              decoration: const InputDecoration(
                labelText: '验证消息',
                hintText: '可选：发送验证消息',
              ),
              maxLines: 2,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () {
              final peerId = peerIdController.text.trim();
              if (peerId.isNotEmpty) {
                controller.addFriend(peerId, message: messageController.text.trim());
                Get.back();
              }
            },
            child: const Text('发送请求'),
          ),
        ],
      ),
    );
  }

  void _showClearDataDialog() {
    Get.dialog(
      AlertDialog(
        title: const Text('清理数据'),
        content: const Text('确定要清理所有聊天数据吗？此操作不可恢复。'),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () {
              controller.clearChatData();
              Get.back();
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('清理'),
          ),
        ],
      ),
    );
  }

  void _showChatOptions(Friend friend) {
    Get.bottomSheet(
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: const Text('查看资料'),
              onTap: () {
                Get.back();
                _showFriendProfile(friend);
              },
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Colors.red),
              title: const Text('删除好友', style: TextStyle(color: Colors.red)),
              onTap: () {
                Get.back();
                _showDeleteFriendDialog(friend);
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showFriendProfile(Friend friend) {
    Get.dialog(
      AlertDialog(
        title: const Text('好友资料'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.blue[100],
                child: Text(friend.name[0].toUpperCase()),
              ),
              title: Text(friend.name),
              subtitle: Text('ID: ${friend.id}'),
            ),
            const SizedBox(height: 16),
            Text('状态: ${friend.status.toString().split('.').last}'),
            Text('在线状态: ${friend.isOnline ? '在线' : '离线'}'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: const Text('关闭'),
          ),
        ],
      ),
    );
  }

  void _showDeleteFriendDialog(Friend friend) {
    Get.dialog(
      AlertDialog(
        title: const Text('删除好友'),
        content: Text('确定要删除好友 "${friend.name}" 吗？'),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: const Text('取消'),
          ),
          ElevatedButton(
            onPressed: () {
              controller.deleteFriend(friend.id);
              Get.back(); // 关闭对话框
              Get.back(); // 返回上一页
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('删除'),
          ),
        ],
      ),
    );
  }

  void _showMoreOptions() {
    Get.bottomSheet(
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera),
              title: const Text('拍照'),
              onTap: () {
                Get.back();
                controller.takePhoto();
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: const Text('从相册选择'),
              onTap: () {
                Get.back();
                // 实现相册选择
              },
            ),
            ListTile(
              leading: const Icon(Icons.file_present),
              title: const Text('发送文件'),
              onTap: () {
                Get.back();
                // 实现文件选择
              },
            ),
            ListTile(
              leading: const Icon(Icons.location_on),
              title: const Text('发送位置'),
              onTap: () {
                Get.back();
                // 实现位置分享
              },
            ),
          ],
        ),
      ),
    );
  }
}
