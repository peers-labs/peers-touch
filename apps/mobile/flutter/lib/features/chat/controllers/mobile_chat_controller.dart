import 'package:get/get.dart';
import 'package:peers_touch_base/chat/chat.dart';
import 'package:peers_touch_base/chat/services/chat_core_service.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/network/rtc/rtc_client.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';

/// 移动端聊天控制器
/// 针对移动端UI特点进行优化，支持页面导航和触摸交互
class MobileChatController extends GetxController {
  
  MobileChatController(this._chatCoreService);
  final ChatCoreService _chatCoreService;
  
  // RTC Client
  RTCClient? rtcClient;
  
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
  final RxString signalingUrl = ''.obs;
  final RxString selfPeerId = ''.obs;
  final RxString selfRole = 'mobile'.obs;
  final RxList<String> selfAddrs = <String>[].obs;

  @override
  void onInit() {
    super.onInit();
    _initializeChat();
  }

  Future<void> registerNetwork() async {
    try {
      final url = signalingUrl.value;
      final id = selfPeerId.value;
      final role = selfRole.value;
      final addrs = selfAddrs.toList();
      if (url.isEmpty || id.isEmpty) {
        Get.snackbar('错误', '请填写信令URL与自身PeerId');
        return;
      }
      final svc = RTCSignalingService(url);
      rtcClient = RTCClient(svc, role: role, peerId: id);
      await rtcClient!.init();

      await svc.registerPeer(id, role, addrs);
      Get.snackbar('成功', '已注册到信令服务并初始化RTC');
      
      // Listen for rtc messages
      rtcClient!.messages().listen((msg) {
         Get.snackbar('RTC消息', msg);
         // You might want to add this to the chat messages list as well
         // messages.add(...);
      });

    } catch (e) {
      Get.snackbar('错误', '注册失败: $e');
    }
  }

  Future<void> joinSession(String remotePeerId) async {
      if (rtcClient == null) {
         Get.snackbar('Error', 'Please register network first');
         return;
      }
      try {
          // Try to answer (join) or call?
          // Based on requirement "join network", typically implies answering or initiating connection
          // Let's assume we try to answer an offer from desktop if we are joining
          await rtcClient!.answer(remotePeerId);
          Get.snackbar('Success', 'Joined/Answered $remotePeerId');
      } catch (e) {
          Get.snackbar('Error', 'Join failed: $e');
      }
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
      // _setupMessageListeners(); // Removed as stream handling needs adjustment
      
    } catch (e) {
      LoggingService.error('Error initializing chat: $e');
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
      LoggingService.error('Error loading friends: $e');
      Get.snackbar('错误', '加载好友列表失败: $e');
    }
  }

  /// 加载会话列表
  Future<void> loadSessions() async {
    try {
      final loadedSessions = await _chatCoreService.getSessions();
      sessions.assignAll(loadedSessions);
    } catch (e) {
      LoggingService.error('Error loading sessions: $e');
      Get.snackbar('错误', '加载会话列表失败: $e');
    }
  }

  /// 选择好友进行聊天（移动端跳转到聊天页面）
  Future<void> selectFriend(Friend friend) async {
    try {
      selectedFriend.value = friend;
      
      // 查找或创建会话
      final session = await _findOrCreateSession(friend.user.id);
      if (session != null) {
        selectedSession.value = session;
        
        // 移动端跳转到聊天页面
        Get.toNamed('/chat/session', arguments: {
          'friend': friend,
          'session': session,
        });
      }
      
    } catch (e) {
      LoggingService.error('Error selecting friend: $e');
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
      LoggingService.error('Error finding or creating session: $e');
      return null;
    }
  }

  /// 加载会话消息（移动端在聊天页面调用）
  Future<void> loadSessionMessages(String sessionId) async {
    try {
      final loadedMessages = await _chatCoreService.getMessages(sessionId);
      messages.assignAll(loadedMessages);
    } catch (e) {
      LoggingService.error('Error loading session messages: $e');
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
      LoggingService.error('Error sending message: $e');
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
      LoggingService.error('Error adding friend: $e');
      Get.snackbar('错误', '添加好友失败: $e');
    }
  }

  /// 删除好友（移动端确认对话框）
  Future<void> deleteFriend(String friendId) async {
    try {
      await _chatCoreService.removeFriend(friendId);
      friends.removeWhere((friend) => friend.user.id == friendId);
      Get.snackbar('成功', '好友已删除');
    } catch (e) {
      LoggingService.error('Error deleting friend: $e');
      Get.snackbar('错误', '删除好友失败: $e');
    }
  }

  /// 搜索好友（移动端实时搜索）
  List<Friend> get searchResults {
    if (searchQuery.value.isEmpty) {
      return friends;
    }
    
    return friends.where((friend) {
      return friend.user.name.toLowerCase().contains(searchQuery.value.toLowerCase()) ||
             friend.user.id.toLowerCase().contains(searchQuery.value.toLowerCase());
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
      // Note: Assuming checking status against DELIVERED/SENT implies unread if logic differs
      // But since we lack UNREAD status in enum, we might skip client-side filtering for now
      // or rely on server logic.
      // Just call markSessionAsRead
      await _chatCoreService.markSessionAsRead(selectedSession.value!.id);
      
    } catch (e) {
      LoggingService.error('Error marking messages as read: $e');
    }
  }

  /// 震动反馈
  void _provideHapticFeedback() {
    // Use haptic feedback plugin if available
  }
}
