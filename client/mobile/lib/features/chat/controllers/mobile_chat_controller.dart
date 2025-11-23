import 'package:get/get.dart';
import 'package:peers_touch_base/chat/chat.dart';

/// 移动端聊天控制器
/// 针对移动端UI特点进行优化，支持页面导航和触摸交互
class MobileChatController extends GetxController {
  final ChatCoreService _chatCoreService;
  
  // 可观察状态
  final RxList<Friend> friends = <Friend>[].obs;
  final RxList<ChatSession> sessions = <ChatSession>[].obs;
  final RxList<ChatMessage> messages = <ChatMessage>[].obs;
  final Rx<Friend?> selectedFriend = Rx<Friend?>(null);
  final Rx<ChatSession?> selectedSession = Rx<ChatSession?>(null);
  final RxString currentMessage = ''.obs;
  final RxBool isLoading = false.obs;
  final RxBool isSending = false.obs;
  final RxString searchQuery = ''.obs;
  
  MobileChatController(this._chatCoreService);

  @override
  void onInit() {
    super.onInit();
    _initializeChat();
  }

  /// 初始化聊天功能
  Future<void> _initializeChat() async {
    try {
      isLoading.value = true;
      
      // 加载好友列表
      await loadFriends();
      
      // 加载会话列表
      await loadSessions();
      
      // 监听新消息
      _setupMessageListeners();
      
    } catch (e) {
      print('Error initializing chat: $e');
      Get.snackbar('错误', '初始化聊天功能失败: $e');
    } finally {
      isLoading.value = false;
    }
  }

  /// 加载好友列表
  Future<void> loadFriends() async {
    try {
      final loadedFriends = await _chatCoreService.getFriends();
      friends.assignAll(loadedFriends);
    } catch (e) {
      print('Error loading friends: $e');
      Get.snackbar('错误', '加载好友列表失败: $e');
    }
  }

  /// 加载会话列表
  Future<void> loadSessions() async {
    try {
      final loadedSessions = await _chatCoreService.getSessions();
      sessions.assignAll(loadedSessions);
    } catch (e) {
      print('Error loading sessions: $e');
      Get.snackbar('错误', '加载会话列表失败: $e');
    }
  }

  /// 选择好友进行聊天（移动端跳转到聊天页面）
  Future<void> selectFriend(Friend friend) async {
    try {
      selectedFriend.value = friend;
      
      // 查找或创建会话
      final session = await _findOrCreateSession(friend.id);
      if (session != null) {
        selectedSession.value = session;
        
        // 移动端跳转到聊天页面
        Get.toNamed('/chat/session', arguments: {
          'friend': friend,
          'session': session,
        });
      }
      
    } catch (e) {
      print('Error selecting friend: $e');
      Get.snackbar('错误', '选择好友失败: $e');
    }
  }

  /// 查找或创建会话
  Future<ChatSession?> _findOrCreateSession(String friendId) async {
    try {
      // 首先尝试查找现有会话
      for (final session in sessions) {
        if (session.participantIds.contains(friendId)) {
          return session;
        }
      }
      
      // 如果没有找到，创建新会话
      final newSession = await _chatCoreService.createSession(friendId);
      sessions.add(newSession);
      return newSession;
      
    } catch (e) {
      print('Error finding or creating session: $e');
      return null;
    }
  }

  /// 加载会话消息（移动端在聊天页面调用）
  Future<void> loadSessionMessages(String sessionId) async {
    try {
      final loadedMessages = await _chatCoreService.getSessionMessages(sessionId);
      messages.assignAll(loadedMessages);
    } catch (e) {
      print('Error loading session messages: $e');
      Get.snackbar('错误', '加载消息失败: $e');
    }
  }

  /// 发送消息（移动端优化版）
  Future<void> sendMessage() async {
    if (currentMessage.value.isEmpty || selectedSession.value == null) {
      return;
    }
    
    try {
      isSending.value = true;
      
      final message = await _chatCoreService.sendMessage(
        selectedSession.value!.id,
        currentMessage.value,
      );
      
      // 添加到消息列表
      messages.add(message);
      currentMessage.value = '';
      
      // 移动端震动反馈（可选）
      _provideHapticFeedback();
      
    } catch (e) {
      print('Error sending message: $e');
      Get.snackbar('错误', '发送消息失败: $e');
    } finally {
      isSending.value = false;
    }
  }

  /// 添加好友（移动端优化对话框）
  Future<void> addFriend(String peerId, {String? message}) async {
    try {
      await _chatCoreService.addFriend(peerId, message: message);
      await loadFriends();
      Get.snackbar('成功', '好友请求已发送');
    } catch (e) {
      print('Error adding friend: $e');
      Get.snackbar('错误', '添加好友失败: $e');
    }
  }

  /// 删除好友（移动端确认对话框）
  Future<void> deleteFriend(String friendId) async {
    try {
      await _chatCoreService.deleteFriend(friendId);
      friends.removeWhere((friend) => friend.id == friendId);
      Get.snackbar('成功', '好友已删除');
    } catch (e) {
      print('Error deleting friend: $e');
      Get.snackbar('错误', '删除好友失败: $e');
    }
  }

  /// 搜索好友（移动端实时搜索）
  List<Friend> get searchResults {
    if (searchQuery.value.isEmpty) {
      return friends;
    }
    
    return friends.where((friend) {
      return friend.name.toLowerCase().contains(searchQuery.value.toLowerCase()) ||
             friend.id.toLowerCase().contains(searchQuery.value.toLowerCase());
    }).toList();
  }

  /// 搜索消息（移动端在聊天页面使用）
  List<ChatMessage> searchMessages(String query) {
    if (query.isEmpty || selectedSession.value == null) {
      return messages;
    }
    
    return messages.where((message) {
      return message.content.toLowerCase().contains(query.toLowerCase());
    }).toList();
  }

  /// 标记消息为已读（移动端进入聊天页面时调用）
  Future<void> markMessagesAsRead() async {
    if (selectedSession.value == null) return;
    
    try {
      final unreadMessages = messages.where((msg) => 
        msg.senderId != _chatCoreService.getCurrentUserId() && 
        msg.status == MessageStatus.UNREAD
      ).toList();
      
      for (final message in unreadMessages) {
        await _chatCoreService.updateMessageStatus(message.id, MessageStatus.READ);
      }
      
      // 更新会话未读数
      await _chatCoreService.updateSessionUnreadCount(selectedSession.value!.id, 0);
      
    } catch (e) {
      print('Error marking messages as read: $e');
    }
  }

  /// 设置消息监听器（移动端使用本地通知）
  void _setupMessageListeners() {
    _chatCoreService.messageStream.listen((message) {
      // 如果消息属于当前会话，添加到消息列表
      if (selectedSession.value?.id == message.sessionId) {
        messages.add(message);
      } else {
        // 显示本地通知（移动端实现）
        _showLocalNotification(message);
      }
    });
  }

  /// 显示本地通知（移动端实现）
  void _showLocalNotification(ChatMessage message) {
    // 移动端可以使用flutter_local_notifications等库
    // 这里简化处理，使用GetX的snackbar
    Get.snackbar(
      '新消息',
      '${message.senderId}: ${message.content}',
      duration: Duration(seconds: 3),
      onTap: (_) {
        // 点击通知时切换到对应会话
        _switchToMessageSession(message);
      },
    );
  }

  /// 切换到消息所属会话
  Future<void> _switchToMessageSession(ChatMessage message) async {
    final session = sessions.firstWhereOrNull((s) => s.id == message.sessionId);
    if (session != null) {
      selectedSession.value = session;
      await loadSessionMessages(session.id);
      
      // 移动端导航到聊天页面
      Get.toNamed('/chat/session', arguments: {
        'session': session,
      });
    }
  }

  /// 震动反馈（移动端特有）
  void _provideHapticFeedback() {
    // 移动端可以使用flutter_haptic等库提供触觉反馈
    // 这里简化处理
    print('Haptic feedback: message sent');
  }

  /// 分享功能（移动端特有）
  Future<void> shareContent(String content) async {
    // 移动端可以使用share_plus等库实现分享功能
    Get.snackbar('提示', '分享功能开发中...');
  }

  /// 语音输入（移动端特有）
  Future<void> startVoiceInput() async {
    // 移动端可以使用speech_to_text等库实现语音输入
    Get.snackbar('提示', '语音输入功能开发中...');
  }

  /// 拍照发送（移动端特有）
  Future<void> takePhoto() async {
    // 移动端可以使用image_picker等库实现拍照功能
    Get.snackbar('提示', '拍照功能开发中...');
  }

  /// 清理聊天数据
  Future<void> clearChatData() async {
    try {
      await _chatCoreService.clearChatData();
      friends.clear();
      sessions.clear();
      messages.clear();
      selectedFriend.value = null;
      selectedSession.value = null;
      Get.snackbar('成功', '聊天数据已清理');
    } catch (e) {
      print('Error clearing chat data: $e');
      Get.snackbar('错误', '清理聊天数据失败: $e');
    }
  }

  @override
  void onClose() {
    // 清理资源
    selectedFriend.value = null;
    selectedSession.value = null;
    searchQuery.value = '';
    super.onClose();
  }
}