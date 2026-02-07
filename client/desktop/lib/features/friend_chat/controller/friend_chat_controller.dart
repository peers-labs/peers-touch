import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' as webrtc;
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/model/domain/chat/friend_chat.pb.dart' as fc;
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/event/event_stream_service.dart';
import 'package:peers_touch_base/network/friend_chat/friend_chat_api_service.dart';
import 'package:peers_touch_base/network/group_chat/group_chat_api_service.dart';
import 'package:peers_touch_base/network/ice/ice_service.dart';
import 'package:peers_touch_base/network/rtc/rtc_client.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';
import 'package:peers_touch_base/network/social/social_api_service.dart';
import 'package:peers_touch_base/storage/chat/chat_cache_service.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/features/friend_chat/friend_chat_module.dart';
import 'package:peers_touch_desktop/features/friend_chat/model/unified_session.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/connection_debug_panel.dart';

class FriendItem {
  final String actorId;
  final String username;
  final String displayName;
  final String? avatarUrl;
  
  FriendItem({
    required this.actorId,
    required this.username,
    required this.displayName,
    this.avatarUrl,
  });
  
  String get name => displayName.isNotEmpty ? displayName : username;
}

class FriendChatController extends GetxController {
  final friends = <FriendItem>[].obs;
  final sessions = <ChatSession>[].obs;
  final messages = <ChatMessage>[].obs;
  final currentSession = Rx<ChatSession?>(null);
  final currentFriend = Rx<FriendItem?>(null);
  final isSending = false.obs;
  final isLoading = false.obs;
  final error = Rx<String?>(null);
  final showEmojiPicker = false.obs;
  
  // ScrollController for message list - auto scroll to bottom
  final ScrollController messageScrollController = ScrollController();
  final ScrollController groupMessageScrollController = ScrollController();
  
  // Scroll position state for smart auto-scroll
  final isUserNearGroupBottom = true.obs;  // Track if user is near bottom of group messages
  final showScrollToLatest = false.obs;    // Show "scroll to latest" banner
  static const _scrollThreshold = 150.0;   // Pixels from bottom to consider "at bottom"
  
  // Thread panel state (Slack-style right panel)
  final showThreadPanel = false.obs;
  final threadParentMessage = Rx<GroupMessageInfo?>(null);
  final threadReplies = <GroupMessageInfo>[].obs;
  final threadInputController = TextEditingController();
  
  // Group info panel state (WeChat-style right panel)
  final showGroupInfoPanel = false.obs;
  
  /// Update the total unread count (updates the shared module-level RxInt for navigation badge)
  void _updateTotalUnreadCount() {
    int total = 0;
    for (final session in unifiedSessions) {
      total += session.unreadCount;
    }
    FriendChatModule.totalUnreadCountRx.value = total;
  }
  
  /// Scroll message list to bottom
  void scrollToBottom({bool animated = true}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (messageScrollController.hasClients) {
        if (animated) {
          messageScrollController.animateTo(
            messageScrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        } else {
          messageScrollController.jumpTo(messageScrollController.position.maxScrollExtent);
        }
      }
    });
  }
  
  /// Scroll group message list to bottom (respects user scroll position)
  /// Only scrolls if user is already near bottom, otherwise shows "scroll to latest" banner
  void scrollGroupToBottom({bool animated = true, bool force = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (groupMessageScrollController.hasClients) {
        // Only auto-scroll if user is near bottom OR force is true
        if (force || isUserNearGroupBottom.value) {
          if (animated) {
            groupMessageScrollController.animateTo(
              groupMessageScrollController.position.maxScrollExtent,
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOut,
            );
          } else {
            groupMessageScrollController.jumpTo(groupMessageScrollController.position.maxScrollExtent);
          }
          showScrollToLatest.value = false;
        } else {
          // User is viewing history, show banner instead
          showScrollToLatest.value = true;
        }
      }
    });
  }
  
  /// User explicitly wants to scroll to latest (e.g. clicked "scroll to latest" button)
  void scrollGroupToLatest() {
    scrollGroupToBottom(animated: true, force: true);
    showScrollToLatest.value = false;
    isUserNearGroupBottom.value = true;
  }
  
  /// Toggle group info panel
  void toggleGroupInfoPanel() {
    if (showGroupInfoPanel.value) {
      showGroupInfoPanel.value = false;
    } else {
      // Close thread panel first
      showThreadPanel.value = false;
      showGroupInfoPanel.value = true;
    }
  }
  
  /// Close group info panel
  void closeGroupInfoPanel() {
    showGroupInfoPanel.value = false;
  }
  
  // Reply state for friend chat
  final replyingToMessage = Rx<ChatMessage?>(null);
  
  /// Toggle emoji picker visibility
  void toggleEmojiPicker() {
    showEmojiPicker.value = !showEmojiPicker.value;
  }
  
  /// Pick and send attachment (image or file)
  Future<void> pickAttachment() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.any,
        allowMultiple: false,
      );
      
      if (result == null || result.files.isEmpty) return;
      
      final file = result.files.first;
      if (file.path == null) return;
      
      // Determine file type and send accordingly
      final extension = file.extension?.toLowerCase() ?? '';
      final isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].contains(extension);
      
      if (isImage) {
        await _sendImageMessage(File(file.path!));
      } else {
        await _sendFileMessage(File(file.path!), file.name);
      }
    } catch (e) {
      LoggingService.error('Failed to pick attachment: $e');
      error.value = 'Failed to pick attachment';
    }
  }
  
  /// Pick and send image specifically
  Future<void> pickImage() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.image,
        allowMultiple: false,
      );
      
      if (result == null || result.files.isEmpty) return;
      
      final file = result.files.first;
      if (file.path == null) return;
      
      await _sendImageMessage(File(file.path!));
    } catch (e) {
      LoggingService.error('Failed to pick image: $e');
      error.value = 'Failed to pick image';
    }
  }
  
  /// Send image message
  Future<void> _sendImageMessage(File file) async {
    // For now, just show a placeholder - actual implementation requires OSS upload
    // TODO: Upload image to OSS and send image message
    LoggingService.info('Image selected: ${file.path}');
    
    // For group chat
    if (currentGroup.value != null) {
      // TODO: Implement group image message
      Get.snackbar(
        '提示',
        '图片发送功能即将上线',
        snackPosition: SnackPosition.BOTTOM,
      );
      return;
    }
    
    // For private chat
    if (currentSession.value != null) {
      // TODO: Implement private chat image message
      Get.snackbar(
        '提示',
        '图片发送功能即将上线',
        snackPosition: SnackPosition.BOTTOM,
      );
      return;
    }
  }
  
  /// Send file message
  Future<void> _sendFileMessage(File file, String fileName) async {
    // TODO: Upload file to OSS and send file message
    LoggingService.info('File selected: ${file.path}, name: $fileName');
    Get.snackbar(
      '提示',
      '文件发送功能即将上线',
      snackPosition: SnackPosition.BOTTOM,
    );
  }
  
  /// Add custom sticker (pick image as sticker)
  Future<void> addCustomSticker() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.image,
        allowMultiple: false,
      );
      
      if (result == null || result.files.isEmpty) return;
      
      final file = result.files.first;
      if (file.path == null) return;
      
      // TODO: Upload image as custom sticker and save to user's sticker collection
      LoggingService.info('Custom sticker image selected: ${file.path}');
      Get.snackbar(
        '提示',
        '自定义表情包功能即将上线',
        snackPosition: SnackPosition.BOTTOM,
      );
    } catch (e) {
      LoggingService.error('Failed to add custom sticker: $e');
    }
  }
  
  /// Start replying to a message (friend chat)
  void startReply(ChatMessage message) {
    replyingToMessage.value = message;
  }
  
  /// Cancel reply (friend chat)
  void cancelReply() {
    replyingToMessage.value = null;
  }
  
  /// Open thread panel for a group message (Slack-style)
  void openThread(GroupMessageInfo message) {
    threadParentMessage.value = message;
    threadReplies.clear();
    showThreadPanel.value = true;
    // TODO: Load replies from server based on message.ulid
    _loadThreadReplies(message.ulid);
  }
  
  /// Close thread panel
  void closeThread() {
    showThreadPanel.value = false;
    threadParentMessage.value = null;
    threadReplies.clear();
  }
  
  /// Load replies for a thread
  Future<void> _loadThreadReplies(String parentUlid) async {
    // TODO: Implement API call to get replies
    // For now, filter local messages that reply to this message
    final replies = groupMessages.where((m) => m.replyToUlid == parentUlid).toList();
    threadReplies.assignAll(replies);
  }
  
  /// Send reply in thread
  Future<void> sendThreadReply(String content) async {
    final parent = threadParentMessage.value;
    if (parent == null || content.trim().isEmpty) return;
    
    final group = currentGroup.value;
    if (group == null) return;
    
    isSending.value = true;
    try {
      final newMessage = await _groupApi.sendMessage(
        groupUlid: group.ulid,
        content: content.trim(),
        type: 1,
        replyToUlid: parent.ulid,
      );
      // Add to thread replies
      threadReplies.add(newMessage);
      // Also add to main message list
      groupMessages.add(newMessage);
      threadInputController.clear();
    } catch (e) {
      LoggingService.error('Failed to send thread reply: $e');
      error.value = 'Failed to send reply';
    } finally {
      isSending.value = false;
    }
  }

  // Unified session list (individuals + groups, sorted by last message time)
  final unifiedSessions = <UnifiedSession>[].obs;
  final currentUnifiedSession = Rx<UnifiedSession?>(null);
  final groups = <GroupInfo>[].obs;
  final currentGroup = Rx<GroupInfo?>(null);
  final groupMessages = <GroupMessageInfo>[].obs;
  final _groupApi = GroupChatApiService();
  
  // Group members cache: groupUlid -> Map<actorDid, GroupMemberInfo>
  final Map<String, Map<String, GroupMemberInfo>> _groupMembersCache = {};

  final connectionStats = const ConnectionStats().obs;
  final connectionMode = ConnectionMode.disconnected.obs;

  late final TextEditingController inputController = TextEditingController();

  final Map<String, List<ChatMessage>> _sessionMessages = {};
  final _chatApi = FriendChatApiService();
  final List<ChatMessage> _pendingMessages = [];
  Timer? _syncTimer;

  static const _syncMessageThreshold = 10;
  /// Message sync interval - reduced from 10s to 3s for better real-time experience
  /// TODO: Replace with WebSocket/SSE for true real-time messaging
  static const _syncTimeInterval = Duration(seconds: 3);

  RTCClient? _rtcClient;
  StreamSubscription<webrtc.RTCPeerConnectionState>? _connectionStateSub;
  StreamSubscription<webrtc.RTCDataChannelState>? _dataChannelStateSub;
  StreamSubscription<String>? _messageSub;

  // Heartbeat and monitoring timers
  Timer? _heartbeatTimer;
  Timer? _peerMonitorTimer;
  RTCSignalingService? _signalingService;
  final _onlinePeers = <String>{};  // Cache of known online peers
  bool _isConnecting = false;  // Prevent concurrent connection attempts

  /// Get current user's DID for P2P signaling
  /// This should return a consistent format (DID) that matches what's stored in session.participantIds
  String get currentUserId {
    if (!Get.isRegistered<GlobalContext>()) return '';
    final gc = Get.find<GlobalContext>();
    // Prefer actorId which should be the DID
    // The actorId might be stored as userId in some cases
    return gc.actorId ?? gc.currentSession?['actorId']?.toString() ?? '';
  }

  /// Get current user's DID (alias for currentUserId for clarity)
  String get currentUserDid => currentUserId;

  String get currentUserName {
    if (!Get.isRegistered<GlobalContext>()) return 'Me';
    final gc = Get.find<GlobalContext>();
    return gc.actorHandle ?? gc.currentSession?['handle']?.toString() ?? 'Me';
  }

  String? get currentUserAvatarUrl {
    if (!Get.isRegistered<GlobalContext>()) return null;
    final gc = Get.find<GlobalContext>();
    return gc.currentSession?['avatarUrl']?.toString();
  }

  String get _stationBaseUrl {
    return HttpServiceLocator().baseUrl.replaceAll(RegExp(r'/$'), '');
  }



  // SSE event subscription
  StreamSubscription<ServerEvent>? _sseSubscription;
  
  @override
  void onInit() {
    super.onInit();
    
    // Guard: verify auth state before making any API calls.
    // If there is no valid token, skip network-dependent initialization
    // to avoid a cascade of 401s that would trigger logout.
    if (!_hasValidToken()) {
      LoggingService.warning(
        'FriendChatController.onInit: No valid token found, '
        'skipping network initialization',
      );
      _initCacheService();
      _initGroupScrollListener();
      return;
    }
    
    _initCacheService();
    _startSyncTimer();
    _markOnline();
    _loadAllSessions(); // Load both individual and group chats
    _loadPendingMessages();
    _initSignalingWithHeartbeat(); // Register and start heartbeat
    _initEventStream(); // Initialize SSE for real-time push
    _initGroupScrollListener(); // Track scroll position for smart auto-scroll
  }

  /// Check whether a valid access token exists before issuing API calls.
  bool _hasValidToken() {
    if (!Get.isRegistered<GlobalContext>()) return false;
    final gc = Get.find<GlobalContext>();
    final token = gc.currentSession?['accessToken']?.toString();
    return token != null && token.isNotEmpty;
  }
  
  /// Initialize scroll listener for group messages to track user's scroll position
  void _initGroupScrollListener() {
    groupMessageScrollController.addListener(_onGroupScroll);
  }
  
  /// Handle group message scroll events
  void _onGroupScroll() {
    if (!groupMessageScrollController.hasClients) return;
    
    final position = groupMessageScrollController.position;
    final maxScroll = position.maxScrollExtent;
    final currentScroll = position.pixels;
    
    // User is "near bottom" if within threshold of max scroll
    final nearBottom = (maxScroll - currentScroll) <= _scrollThreshold;
    
    if (nearBottom != isUserNearGroupBottom.value) {
      isUserNearGroupBottom.value = nearBottom;
    }
    
    // Hide "scroll to latest" when user scrolls to bottom
    if (nearBottom && showScrollToLatest.value) {
      showScrollToLatest.value = false;
    }
  }
  
  /// Initialize SSE event stream for real-time message push
  void _initEventStream() {
    try {
      final baseUrl = HttpServiceLocator().baseUrl;
      if (baseUrl.isEmpty) {
        LoggingService.warning('[FriendChatController] No baseUrl, skipping SSE init');
        return;
      }
      
      // Connect to SSE stream
      EventStreamService.instance.connect(baseUrl);
      
      // Subscribe to events
      _sseSubscription = EventStreamService.instance.events.listen(
        _handleServerEvent,
        onError: (e) => LoggingService.error('[FriendChatController] SSE error: $e'),
      );
      
      LoggingService.info('[FriendChatController] SSE event stream initialized');
    } catch (e) {
      LoggingService.warning('[FriendChatController] SSE init failed: $e');
    }
  }
  
  /// Handle incoming server events
  void _handleServerEvent(ServerEvent event) {
    LoggingService.debug('[FriendChatController] Received event: ${event.type}');
    
    switch (event.type) {
      case EventType.chatMessageAppended:
        _handleNewMessageEvent(event);
        break;
      case EventType.chatMessageRead:
        _handleMessageReadEvent(event);
        break;
      case EventType.chatMessageDelivered:
        _handleMessageDeliveredEvent(event);
        break;
      default:
        LoggingService.debug('[FriendChatController] Unhandled event type: ${event.type}');
    }
  }
  
  /// Handle new message event from SSE
  void _handleNewMessageEvent(ServerEvent event) {
    final payload = event.chatMessagePayload;
    if (payload == null) return;
    
    LoggingService.info('[FriendChatController] New message via SSE: ${payload.messageId} from ${payload.senderId}');
    
    // Check if it's a group message or individual message
    if (payload.msgType == 'group') {
      // Group message: refresh group messages if this group is selected
      if (currentGroup.value?.ulid == payload.convId) {
        // Use smart refresh instead of re-selecting the group to avoid UI flickering
        _refreshCurrentGroupMessages();
      }
      
      // Update unread count in unified sessions
      final index = unifiedSessions.indexWhere((s) => s.id == payload.convId);
      if (index >= 0 && unifiedSessions[index].id != currentGroup.value?.ulid) {
        final session = unifiedSessions[index];
        unifiedSessions[index] = session.copyWith(
          unreadCount: session.unreadCount + 1,
          lastMessage: payload.content ?? '',
          lastMessageTime: DateTime.fromMillisecondsSinceEpoch(payload.timestamp),
        );
        _updateTotalUnreadCount();
      }
    } else {
      // Individual message: add to messages list if this friend is selected
      final isCurrentChat = currentFriend.value?.actorId == payload.senderId;
      
      if (isCurrentChat) {
        // Trigger a refresh of messages for current chat
        _fetchNewMessages();
        scrollToBottom();
      }
      
      // Update unread count in unified sessions
      final index = unifiedSessions.indexWhere((s) => s.id == payload.senderId);
      if (index >= 0 && !isCurrentChat) {
        final session = unifiedSessions[index];
        unifiedSessions[index] = session.copyWith(
          unreadCount: session.unreadCount + 1,
          lastMessage: payload.content ?? '',
          lastMessageTime: DateTime.fromMillisecondsSinceEpoch(payload.timestamp),
        );
        _updateTotalUnreadCount();
      }
    }
  }
  
  /// Handle message read event from SSE
  void _handleMessageReadEvent(ServerEvent event) {
    // Update message status to read
    final msgId = event.payload['messageId'] as String?;
    if (msgId == null) return;
    
    LoggingService.debug('[FriendChatController] Message $msgId marked as read');
  }
  
  /// Handle message delivered event from SSE
  void _handleMessageDeliveredEvent(ServerEvent event) {
    final msgId = event.payload['messageId'] as String?;
    if (msgId == null) return;
    
    LoggingService.debug('[FriendChatController] Message $msgId delivered');
  }
  
  /// Fetch new messages for current chat
  Future<void> _fetchNewMessages() async {
    if (currentFriend.value == null) return;
    
    try {
      final fetchedMessages = await _chatApi.getMessages(currentFriend.value!.actorId, limit: 20);
      // Note: The actual message loading is handled by selectFriend/loadMessages
      // This is just a refresh trigger
      LoggingService.debug('[FriendChatController] Refreshed messages');
    } catch (e) {
      LoggingService.error('[FriendChatController] Failed to fetch new messages: $e');
    }
  }

  /// 初始化本地缓存服务
  Future<void> _initCacheService() async {
    if (currentUserId.isEmpty) return;
    try {
      await ChatCacheService.instance.initialize(currentUserId);
      LoggingService.info('ChatCacheService initialized for user: $currentUserId');
    } catch (e) {
      LoggingService.error('Failed to init ChatCacheService: $e');
    }
  }

  /// Load both friends and groups, then merge into unified list
  Future<void> _loadAllSessions() async {
    isLoading.value = true;
    error.value = null;

    try {
      // Load friends and groups in parallel
      await Future.wait([
        _loadFriendsInternal(),
        _loadGroupsInternal(),
      ]);

      // Merge into unified session list
      _mergeUnifiedSessions();
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> _loadFriendsInternal() async {
    try {
      if (currentUserId.isEmpty) return;

      final socialApi = SocialApiService();
      final response = await socialApi.getFollowing();
      final followingList = response.following;

      final friendList = followingList.map((f) => FriendItem(
        actorId: f.actorId,
        username: f.username,
        displayName: f.displayName,
        avatarUrl: f.avatarUrl,
      )).toList();

      friends.assignAll(friendList);
      LoggingService.info('Loaded ${friendList.length} friends');
    } catch (e) {
      LoggingService.error('Failed to load friends: $e');
    }
  }

  Future<void> _loadGroupsInternal() async {
    try {
      if (currentUserId.isEmpty) return;

      final groupList = await _groupApi.listGroups();
      groups.assignAll(groupList);
      LoggingService.info('Loaded ${groupList.length} groups');
    } catch (e) {
      LoggingService.error('Failed to load groups: $e');
    }
  }

  void _mergeUnifiedSessions() {
    _mergeUnifiedSessionsAsync();
  }

  Future<void> _mergeUnifiedSessionsAsync() async {
    final unified = <UnifiedSession>[];
    final cache = ChatCacheService.instance;

    // 尝试从缓存获取会话信息
    Map<String, dynamic> cachedSessionInfo = {};
    try {
      final cachedSessions = await cache.getSessions();
      for (final s in cachedSessions) {
        cachedSessionInfo[s.targetId] = {
          'lastMessage': s.lastMessageSnippet,
          'lastMessageAt': s.lastMessageAt != null 
              ? DateTime.fromMillisecondsSinceEpoch(s.lastMessageAt!)
              : null,
          'lastMessageType': s.lastMessageType,
          'unreadCount': s.unreadCount,
          'isPinned': s.isPinned,
          'isMuted': s.isMuted,
        };
      }
    } catch (e) {
      LoggingService.warning('Failed to load cached sessions: $e');
    }

    // Add individual chats from friends
    for (final friend in friends) {
      final cached = cachedSessionInfo[friend.actorId];
      unified.add(UnifiedSession(
        id: friend.actorId,
        type: UnifiedSessionType.individual,
        name: friend.name,
        subtitle: '@${friend.username}',
        avatarUrl: friend.avatarUrl,
        lastMessage: cached?['lastMessage'],
        lastMessageTime: cached?['lastMessageAt'],
        lastMessageType: cached?['lastMessageType'] != null 
            ? MessageType.valueOf(cached['lastMessageType'])
            : null,
        unreadCount: cached?['unreadCount'] ?? 0,
        isPinned: cached?['isPinned'] ?? false,
        isMuted: cached?['isMuted'] ?? false,
        originalData: friend,
      ));
    }

    // Add group chats with unread counts from server
    for (final group in groups) {
      final cached = cachedSessionInfo[group.ulid];
      
      // Try to get unread count from server
      int unreadCount = cached?['unreadCount'] ?? 0;
      try {
        unreadCount = await _groupApi.getUnreadCount(groupUlid: group.ulid);
      } catch (_) {
        // Use cached value if API fails
      }
      
      unified.add(UnifiedSession(
        id: group.ulid,
        type: UnifiedSessionType.group,
        name: group.name,
        subtitle: '${group.memberCount} 人',
        avatarUrl: group.avatarCid,
        lastMessage: cached?['lastMessage'],
        lastMessageTime: cached?['lastMessageAt'] ?? 
            (group.updatedAt > 0
                ? DateTime.fromMillisecondsSinceEpoch(group.updatedAt * 1000)
                : null),
        lastMessageType: cached?['lastMessageType'] != null 
            ? MessageType.valueOf(cached['lastMessageType'])
            : null,
        unreadCount: unreadCount,
        isPinned: cached?['isPinned'] ?? false,
        isMuted: cached?['isMuted'] ?? false,
        originalData: group,
      ));
    }

    // Sort by last message time (most recent first), pinned items at top
    unified.sort(UnifiedSession.compareByTime);
    unifiedSessions.assignAll(unified);
    _updateTotalUnreadCount();
  }

  /// Select a unified session (individual or group)
  Future<void> selectUnifiedSession(UnifiedSession session) async {
    currentUnifiedSession.value = session;

    if (session.isIndividual) {
      final friend = session.originalData as FriendItem;
      currentGroup.value = null;
      groupMessages.clear();
      await selectFriend(friend);
    } else {
      final group = session.originalData as GroupInfo;
      currentFriend.value = null;
      currentSession.value = null;
      messages.clear();
      await _selectGroup(group);
    }
    
    // Clear unread count (persists to local DB and syncs to server)
    if (session.unreadCount > 0) {
      await _clearUnreadCount(session.id, isGroup: session.isGroup);
    }
  }
  
  /// Clear unread count for a session (updates memory, local DB, and server)
  /// Respects user's privacy setting: send_read_receipts
  Future<void> _clearUnreadCount(String sessionId, {bool isGroup = false}) async {
    // 1. Update memory state
    final index = unifiedSessions.indexWhere((s) => s.id == sessionId);
    if (index >= 0) {
      final session = unifiedSessions[index];
      unifiedSessions[index] = session.copyWith(unreadCount: 0);
      _updateTotalUnreadCount();
    }
    
    // 2. Persist to local database (always do this)
    try {
      await ChatCacheService.instance.clearUnreadCount(sessionId);
      LoggingService.info('Cleared unread count in local DB for session: $sessionId');
    } catch (e) {
      LoggingService.warning('Failed to clear unread count in local DB: $e');
    }
    
    // 3. Check user's privacy setting before sending read receipts
    bool shouldSendReadReceipts = true;
    if (Get.isRegistered<GlobalContext>()) {
      final gc = Get.find<GlobalContext>();
      final flags = gc.preferences['feature_flags'];
      if (flags is Map && flags['send_read_receipts'] == false) {
        shouldSendReadReceipts = false;
        LoggingService.info('Read receipts disabled by user setting');
      }
    }
    
    // 4. Sync to server
    if (isGroup) {
      // Mark group messages as read on server
      try {
        final markedCount = await _groupApi.markGroupAsRead(sessionId);
        LoggingService.info('Marked $markedCount messages as read for group: $sessionId');
      } catch (e) {
        LoggingService.warning('Failed to mark group as read on server: $e');
      }
    } else if (shouldSendReadReceipts) {
      // For individual chats - read receipts are optional based on privacy setting
      LoggingService.debug('Would sync read status to server for session: $sessionId');
    }
  }

  Future<void> _selectGroup(GroupInfo group) async {
    currentGroup.value = group;
    groupMessages.clear();
    
    // Reset scroll state when switching groups
    isUserNearGroupBottom.value = true;
    showScrollToLatest.value = false;
    
    try {
      // Load members first for name resolution
      await _loadGroupMembers(group.ulid);
      
      final loadedMessages = await _groupApi.getMessages(group.ulid);
      groupMessages.assignAll(loadedMessages);
      
      // Auto scroll to bottom after loading (force because it's initial load)
      scrollGroupToBottom(animated: false, force: true);
      
      LoggingService.info('Loaded ${loadedMessages.length} messages for group ${group.ulid}');
    } catch (e) {
      LoggingService.error('Failed to load group messages: $e');
      error.value = 'Failed to load messages';
    }
  }
  
  /// Load and cache group members
  Future<void> _loadGroupMembers(String groupUlid) async {
    if (_groupMembersCache.containsKey(groupUlid)) {
      return; // Already cached
    }
    
    try {
      final members = await _groupApi.getMembers(groupUlid);
      final memberMap = <String, GroupMemberInfo>{};
      for (final member in members) {
        memberMap[member.actorDid] = member;
      }
      _groupMembersCache[groupUlid] = memberMap;
      LoggingService.info('Cached ${members.length} members for group $groupUlid');
    } catch (e) {
      LoggingService.error('Failed to load group members: $e');
    }
  }
  
  /// Get member display name for a group
  String getMemberDisplayName(String groupUlid, String actorDid) {
    // 1. Check group member nickname
    final members = _groupMembersCache[groupUlid];
    if (members != null) {
      final member = members[actorDid];
      if (member != null && member.nickname.isNotEmpty) {
        return member.nickname;
      }
    }
    
    // 2. Check friends list for display name
    final friend = friends.firstWhereOrNull((f) => f.actorId == actorDid);
    if (friend != null && friend.name.isNotEmpty) {
      return friend.name;
    }
    
    // 3. Fallback to truncated ID
    return _truncateActorId(actorDid);
  }
  
  String _truncateActorId(String actorId) {
    if (actorId.length > 10) {
      return '${actorId.substring(0, 4)}...${actorId.substring(actorId.length - 4)}';
    }
    return actorId;
  }
  
  /// Get member avatar URL for a group
  String? getMemberAvatarUrl(String groupUlid, String actorDid) {
    // 1. Check group member cache for avatar
    final members = _groupMembersCache[groupUlid];
    if (members != null) {
      final member = members[actorDid];
      if (member != null && member.avatarUrl.isNotEmpty) {
        return member.avatarUrl;
      }
    }
    
    // 2. Check friends list for avatar
    final friend = friends.firstWhereOrNull((f) => f.actorId == actorDid);
    if (friend != null && friend.avatarUrl != null && friend.avatarUrl!.isNotEmpty) {
      return friend.avatarUrl;
    }
    
    return null;
  }

  /// Send message to current group
  Future<void> sendGroupMessage(String content) async {
    final group = currentGroup.value;
    if (group == null || content.trim().isEmpty) return;

    isSending.value = true;
    error.value = null;

    try {
      final newMessage = await _groupApi.sendMessage(
        groupUlid: group.ulid,
        content: content.trim(),
        type: 1, // TEXT
      );
      groupMessages.add(newMessage);
      inputController.clear();
      // Force scroll to bottom after sending (user's own message)
      scrollGroupToBottom(force: true);
      LoggingService.info('Group message sent: ${newMessage.ulid}');
    } catch (e) {
      LoggingService.error('Failed to send group message: $e');
      error.value = 'Failed to send message';
    } finally {
      isSending.value = false;
    }
  }

  /// Refresh all sessions
  Future<void> refreshAllSessions() async {
    await _loadAllSessions();
  }

  /// Initialize signaling service with heartbeat for persistent presence
  Future<void> _initSignalingWithHeartbeat() async {
    if (currentUserId.isEmpty) {
      LoggingService.warning('FriendChatController: Cannot init signaling - no user ID');
      return;
    }

    _signalingService = RTCSignalingService(_signalingUrl);
    
    // Initial registration
    await _registerWithSignaling();
    
    // Start heartbeat timer (refresh registration every 30 seconds)
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      _refreshSignalingRegistration();
    });

    // Start peer monitoring timer (check for online peers every 5 seconds)
    _peerMonitorTimer?.cancel();
    _peerMonitorTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _checkPeersAndOffers();
    });
  }

  /// Refresh signaling registration (heartbeat)
  Future<void> _refreshSignalingRegistration() async {
    if (_signalingService == null || currentUserId.isEmpty) return;
    try {
      await _signalingService!.registerPeer(currentUserId, 'peer', []);
    } catch (e) {
      LoggingService.warning('Failed to refresh signaling registration: $e');
    }
  }

  /// Monitor online peers and incoming offers
  Future<void> _checkPeersAndOffers() async {
    if (_signalingService == null || currentUserId.isEmpty) return;
    
    try {
      // Get all online peers
      final peers = await _signalingService!.getPeers();
      final newOnlinePeers = <String>{};
      
      for (final peer in peers) {
        final peerId = peer['id']?.toString() ?? '';
        if (peerId.isNotEmpty && peerId != currentUserId) {
          newOnlinePeers.add(peerId);
          
          // Check if this is a new peer coming online
          if (!_onlinePeers.contains(peerId)) {
            LoggingService.info('Peer came online: $peerId');
            _onPeerOnline(peerId);
          }
        }
      }
      
      // Check if online status changed
      final statusChanged = !_setEquals(_onlinePeers, newOnlinePeers);
      
      // Update online peers cache
      _onlinePeers.clear();
      _onlinePeers.addAll(newOnlinePeers);
      
      // Update unified sessions online status if changed
      if (statusChanged) {
        _updateSessionsOnlineStatus();
      }
      
      // Check for incoming offers if we have a selected friend
      await _checkIncomingOffers();
      
    } catch (e) {
      // Silently ignore monitoring errors
    }
  }
  
  /// Helper to compare two sets
  bool _setEquals<T>(Set<T> a, Set<T> b) {
    if (a.length != b.length) return false;
    return a.every((e) => b.contains(e));
  }
  
  /// Update online status in unified sessions
  void _updateSessionsOnlineStatus() {
    bool hasChanges = false;
    for (int i = 0; i < unifiedSessions.length; i++) {
      final session = unifiedSessions[i];
      // Only update individual sessions
      if (session.isIndividual) {
        final isOnline = _onlinePeers.contains(session.id);
        if (session.isOnline != isOnline) {
          unifiedSessions[i] = session.copyWith(isOnline: isOnline);
          hasChanges = true;
        }
      }
    }
    if (hasChanges) {
      unifiedSessions.refresh();
    }
  }
  
  /// Check if a peer is online (public getter for UI)
  bool isPeerOnline(String peerId) => _onlinePeers.contains(peerId);

  /// Called when a peer comes online
  void _onPeerOnline(String peerId) {
    // Check if this is the currently selected friend
    final remotePeerId = connectionStats.value.remotePeerId;
    if (remotePeerId == peerId && 
        connectionMode.value != ConnectionMode.p2pDirect &&
        !_isConnecting) {
      LoggingService.info('Selected friend $peerId is now online, initiating P2P connection');
      _autoConnect(peerId);
    }
  }

  /// Check for incoming offers from the selected friend
  Future<void> _checkIncomingOffers() async {
    if (_signalingService == null) return;
    
    final remotePeerId = connectionStats.value.remotePeerId;
    if (remotePeerId.isEmpty) return;
    
    // Already connected or connecting
    if (connectionMode.value == ConnectionMode.p2pDirect || _isConnecting) return;
    
    // Check if there's an offer waiting for us
    final sessionId = _canonicalSessionId(currentUserId, remotePeerId);
    try {
      final offer = await _signalingService!.getOffer(sessionId);
      if (offer != null && _rtcClient == null && !_isConnecting) {
        LoggingService.info('Found incoming offer from $remotePeerId, responding...');
        _autoConnect(remotePeerId);
      }
    } catch (e) {
      // Silently ignore
    }
  }

  /// Generate canonical session ID (same as RTCClient)
  String _canonicalSessionId(String peerA, String peerB) {
    final ids = [peerA, peerB]..sort();
    return '${ids[0]}-${ids[1]}';
  }

  /// Register this peer with the signaling server (without connecting to a remote peer)
  Future<void> _registerWithSignaling() async {
    if (currentUserId.isEmpty) {
      LoggingService.warning('FriendChatController: Cannot register with signaling - no user ID');
      return;
    }

    connectionStats.value = connectionStats.value.copyWith(
      connectionState: P2PConnectionState.connecting,
      signalingUrl: _signalingUrl,
      localPeerId: currentUserId,
      isRegistered: false,
    );

    try {
      final signaling = RTCSignalingService(_signalingUrl);
      await signaling.registerPeer(currentUserId, 'peer', []);
      
      connectionStats.value = connectionStats.value.copyWith(
        isRegistered: true,
        connectionState: P2PConnectionState.disconnected, // Registered but not connected to a peer
      );
      LoggingService.info('FriendChatController: Registered with signaling server as $currentUserId');
    } catch (e) {
      LoggingService.error('FriendChatController: Failed to register with signaling: $e');
      connectionStats.value = connectionStats.value.copyWith(
        connectionState: P2PConnectionState.failed,
        isRegistered: false,
      );
    }
  }

  @override
  void onClose() {
    _markOffline();
    _syncTimer?.cancel();
    _heartbeatTimer?.cancel();
    _peerMonitorTimer?.cancel();
    inputController.dispose();
    _connectionStateSub?.cancel();
    _dataChannelStateSub?.cancel();
    _messageSub?.cancel();
    _sseSubscription?.cancel();
    EventStreamService.instance.disconnect();
    groupMessageScrollController.removeListener(_onGroupScroll);
    super.onClose();
  }

  void _startSyncTimer() {
    _syncTimer = Timer.periodic(_syncTimeInterval, (_) {
      if (_pendingMessages.isNotEmpty) {
        _syncPendingMessages();
      }
      // Refresh current group messages
      _refreshCurrentGroupMessages();
      // Poll all sessions for new unread (every 2 intervals = 6 seconds)
      _pollCounter++;
      if (_pollCounter >= 2) {
        _pollCounter = 0;
        _pollAllSessionsForNewMessages();
      }
      // Check session validity (every 30 seconds via counter)
      _sessionCheckCounter++;
      if (_sessionCheckCounter >= 10) { // Check every ~30 seconds (10 * 3s)
        _sessionCheckCounter = 0;
        _checkSessionValidity();
      }
    });
  }
  
  int _pollCounter = 0;
  
  int _sessionCheckCounter = 0;
  
  /// Check if current session is still valid (not kicked).
  /// Uses HttpServiceLocator to stay consistent with global auth interceptor.
  Future<void> _checkSessionValidity() async {
    try {
      final gc = Get.find<GlobalContext>();
      final sessionId = gc.currentSession?['sessionId']?.toString();
      if (sessionId == null || sessionId.isEmpty) return;

      // Use the shared HttpServiceLocator — tokens and session headers
      // are attached automatically by AuthInterceptor.
      final client = HttpServiceLocator().httpService;
      final response = await client.getResponse<dynamic>('/api/v1/session/verify');

      if (response.statusCode == 200 && response.data is Map) {
        final data = response.data as Map;
        final valid = data['valid'] == true;
        final reason = data['reason']?.toString() ?? '';

        if (!valid && reason == 'kicked') {
          LoggingService.warning('Session kicked by another login');
          _handleSessionKicked();
        }
      }
    } catch (e) {
      // Network error - don't trigger logout
      LoggingService.error('Session check failed: $e');
    }
  }

  /// Handle session kicked — use the unified logout mechanism via
  /// GlobalContext.requestLogout() so that token cleanup, session clearing,
  /// navigation, and snackbar are all handled in one place (main.dart listener).
  void _handleSessionKicked() {
    if (Get.isRegistered<GlobalContext>()) {
      Get.find<GlobalContext>().requestLogout(
        LogoutReason.forcedByServer,
        message: '您的账号在另一个设备上登录，当前设备已被登出',
      );
    }
  }
  
  /// Refresh messages for current group (polling for new messages)
  /// Uses smart comparison to avoid unnecessary UI updates
  Future<void> _refreshCurrentGroupMessages() async {
    final group = currentGroup.value;
    if (group == null) return;
    
    try {
      final loadedMessages = await _groupApi.getMessages(group.ulid);
      
      // Build sets for comparison
      final currentUlids = groupMessages.map((m) => m.ulid).toSet();
      final serverUlids = loadedMessages.map((m) => m.ulid).toSet();
      
      // Check if server has new messages we don't have locally
      final newMessageUlids = serverUlids.difference(currentUlids);
      
      // Check if we have messages locally that server doesn't have (should not happen normally)
      final removedMessageUlids = currentUlids.difference(serverUlids);
      
      // No changes at all
      if (newMessageUlids.isEmpty && removedMessageUlids.isEmpty) {
        return;
      }
      
      // Only new messages added (most common case for real-time chat)
      if (newMessageUlids.isNotEmpty && removedMessageUlids.isEmpty) {
        // Find new messages in server order and append them
        final newMessages = loadedMessages.where((m) => newMessageUlids.contains(m.ulid)).toList();
        groupMessages.addAll(newMessages);
        scrollGroupToBottom();
        return;
      }
      
      // Messages were deleted or some complex change - need full refresh
      // But do it carefully to minimize UI impact
      if (removedMessageUlids.isNotEmpty) {
        // Remove deleted messages from local list
        groupMessages.removeWhere((m) => removedMessageUlids.contains(m.ulid));
      }
      
      // Add any new messages
      if (newMessageUlids.isNotEmpty) {
        final newMessages = loadedMessages.where((m) => newMessageUlids.contains(m.ulid)).toList();
        groupMessages.addAll(newMessages);
        scrollGroupToBottom();
      }
    } catch (e) {
      // Silently ignore refresh errors
    }
  }
  
  /// Poll all sessions for new unread messages (called periodically)
  Future<void> _pollAllSessionsForNewMessages() async {
    try {
      bool hasChanges = false;
      
      // Check all group sessions for new unread counts
      for (int i = 0; i < unifiedSessions.length; i++) {
        final session = unifiedSessions[i];
        if (!session.isGroup) continue;
        
        // Skip current group (already handled by _refreshCurrentGroupMessages)
        if (session.id == currentGroup.value?.ulid) continue;
        
        try {
          final serverUnread = await _groupApi.getUnreadCount(groupUlid: session.id);
          if (serverUnread != session.unreadCount) {
            unifiedSessions[i] = session.copyWith(unreadCount: serverUnread);
            hasChanges = true;
            LoggingService.debug('[Poll] Group ${session.name} unread: $serverUnread');
          }
        } catch (e) {
          // Skip this session on error
        }
      }
      
      // Update total unread count if there were changes
      if (hasChanges) {
        _updateTotalUnreadCount();
      }
    } catch (e) {
      LoggingService.error('[Poll] Failed to poll sessions: $e');
    }
  }

  Future<void> _markOnline() async {
    if (currentUserId.isEmpty) return;
    try {
      await _chatApi.markOnline(currentUserId);
      LoggingService.info('Marked online: $currentUserId');
    } catch (e) {
      LoggingService.warning('Failed to mark online: $e');
    }
  }

  Future<void> _markOffline() async {
    if (currentUserId.isEmpty) return;
    try {
      await _chatApi.markOffline(currentUserId);
      LoggingService.info('Marked offline: $currentUserId');
    } catch (e) {
      LoggingService.warning('Failed to mark offline: $e');
    }
  }

  // Note: _loadFriends replaced by _loadFriendsInternal for unified loading

  Future<void> _loadPendingMessages() async {
    if (currentUserId.isEmpty) return;
    try {
      final pendingMsgs = await _chatApi.getPendingMessages(currentUserId);
      LoggingService.info('Loaded ${pendingMsgs.length} pending messages');

      for (final pending in pendingMsgs) {
        final content = utf8.decode(pending.encryptedPayload);
        final sessionId = 'session_${pending.sessionUlid}';
        
        final session = sessions.firstWhereOrNull((s) => s.id == sessionId);
        if (session == null) continue;

        final newMessage = ChatMessage(
          id: pending.ulid,
          sessionId: sessionId,
          senderId: pending.senderDid,
          content: content,
          sentAt: Timestamp.fromDateTime(
            DateTime.fromMillisecondsSinceEpoch(pending.createdAt * 1000),
          ),
          type: MessageType.MESSAGE_TYPE_TEXT,
          status: MessageStatus.MESSAGE_STATUS_DELIVERED,
        );

        if (currentSession.value?.id == sessionId) {
          messages.add(newMessage);
        }
        
        final sessionMsgs = _sessionMessages[sessionId] ?? [];
        sessionMsgs.add(newMessage);
        _sessionMessages[sessionId] = sessionMsgs;
      }

      if (pendingMsgs.isNotEmpty) {
        await _chatApi.ackMessages(
          pendingMsgs.map((m) => m.ulid).toList(),
          status: 2,
        );
      }
    } catch (e) {
      LoggingService.warning('Failed to load pending messages: $e');
    }
  }

  Future<void> _syncPendingMessages() async {
    if (_pendingMessages.isEmpty) return;

    final toSync = List<ChatMessage>.from(_pendingMessages);
    _pendingMessages.clear();

    connectionStats.value = connectionStats.value.copyWith(
      pendingSyncCount: 0,
    );

    try {
      final request = fc.SyncMessagesRequest(
        messages: toSync.map((msg) {
          final ft = fc.FriendMessageType.values.firstWhere(
            (e) => e.value == msg.type.value,
            orElse: () => fc.FriendMessageType.FRIEND_MESSAGE_TYPE_TEXT,
          );
          return fc.SyncMessageItem(
            ulid: msg.id,
            sessionUlid: msg.sessionId.replaceFirst('session_', ''),
            receiverDid: connectionStats.value.remotePeerId,
            type: ft,
            content: msg.content,
            sentAt: msg.sentAt,
          );
        }).toList(),
      );
      final response = await _chatApi.syncMessages(request);
      LoggingService.info('Synced ${response.synced} messages to server');

      connectionStats.value = connectionStats.value.copyWith(
        lastSyncAt: DateTime.now(),
      );

      if (response.failed.isNotEmpty) {
        LoggingService.warning('Failed to sync ${response.failed.length} messages');
        final failedMessages = toSync.where((m) => response.failed.contains(m.id)).toList();
        _pendingMessages.addAll(failedMessages);
        connectionStats.value = connectionStats.value.copyWith(
          pendingSyncCount: _pendingMessages.length,
        );
      }
    } catch (e) {
      LoggingService.error('Failed to sync messages: $e');
      _pendingMessages.insertAll(0, toSync);
      connectionStats.value = connectionStats.value.copyWith(
        pendingSyncCount: _pendingMessages.length,
      );
    }
  }

  Future<void> _loadSessionsFromFriends() async {
    LoggingService.info('FriendChatController: Starting to load sessions from friends');
    isLoading.value = true;
    error.value = null;

    try {
      if (currentUserId.isEmpty) {
        LoggingService.error('FriendChatController: Current user ID is empty, cannot load sessions');
        error.value = 'User not logged in';
        return;
      }

      LoggingService.info('FriendChatController: Current user ID: $currentUserId');

      final socialApi = SocialApiService();
      final response = await socialApi.getFollowing();
      final followingList = response.following;
      
      LoggingService.info('FriendChatController: Loaded ${followingList.length} following users');

      if (followingList.isEmpty) {
        LoggingService.info('FriendChatController: No following users found');
        return;
      }

      final sessionList = <ChatSession>[];

      for (final following in followingList) {
        try {
          LoggingService.info('FriendChatController: Creating session for actorId=${following.actorId}, username=${following.username}, displayName="${following.displayName}"');
          final createResponse = await _chatApi.createSession(following.actorId);
          LoggingService.info('FriendChatController: Session created with ULID: ${createResponse.session.ulid}');
          
          final session = ChatSession(
            id: 'session_${createResponse.session.ulid}',
            topic: following.displayName.isNotEmpty ? following.displayName : following.username,
            participantIds: [currentUserId, following.actorId],
            type: SessionType.SESSION_TYPE_DIRECT,
          );
          sessionList.add(session);
          _sessionMessages['session_${createResponse.session.ulid}'] = [];
        } catch (e, stackTrace) {
          LoggingService.error('FriendChatController: Failed to create session for ${following.actorId}: $e');
          LoggingService.debug('Stack trace: $stackTrace');
        }
      }

      LoggingService.info('FriendChatController: Created ${sessionList.length} sessions');
      sessions.assignAll(sessionList);

      if (sessionList.isNotEmpty && currentSession.value == null) {
        selectSession(sessionList.first);
        LoggingService.info('FriendChatController: Auto-selected first session: ${sessionList.first.topic}');
      }
    } catch (e, stackTrace) {
      LoggingService.error('FriendChatController: Failed to load sessions from following: $e');
      LoggingService.debug('Stack trace: $stackTrace');
      error.value = 'Failed to load chat sessions: $e';
    } finally {
      isLoading.value = false;
      LoggingService.info('FriendChatController: Finished loading sessions, total: ${sessions.length}');
    }
  }

  Future<void> refreshSessions() async {
    await _loadAllSessions();
  }

  Future<void> selectFriend(FriendItem friend) async {
    LoggingService.info('FriendChatController: Selecting friend ${friend.name} (${friend.actorId})');
    LoggingService.info('FriendChatController: currentUserId=$currentUserId, friend.actorId=${friend.actorId}');
    currentFriend.value = friend;
    
    try {
      final response = await _chatApi.createSession(friend.actorId);
      final sessionUlid = response.session.ulid;
      
      LoggingService.info('FriendChatController: Session created/retrieved: $sessionUlid');
      
      final session = ChatSession(
        id: 'session_$sessionUlid',
        topic: friend.name,
        participantIds: [currentUserId, friend.actorId],
        type: SessionType.SESSION_TYPE_DIRECT,
      );
      
      final existingIndex = sessions.indexWhere((s) => s.id == session.id);
      if (existingIndex == -1) {
        sessions.insert(0, session);
        _sessionMessages[session.id] = [];
      }
      
      // Directly set remotePeerId to friend's actorId to avoid ID format mismatch
      connectionStats.value = connectionStats.value.copyWith(
        remotePeerId: friend.actorId,
      );
      
      currentSession.value = session;
      final sessionMsgs = _sessionMessages[session.id] ?? [];
      messages.assignAll(sessionMsgs);
      
      _loadMessagesFromServer(session);
      _autoConnect(friend.actorId);  // Use friend.actorId directly
    } catch (e, stackTrace) {
      LoggingService.error('FriendChatController: Failed to create session: $e');
      LoggingService.debug('Stack trace: $stackTrace');
      error.value = 'Failed to start chat: $e';
    }
  }

  void selectSession(ChatSession session) {
    currentSession.value = session;
    final sessionMsgs = _sessionMessages[session.id] ?? [];
    messages.assignAll(sessionMsgs);

    final remotePeerId = session.participantIds.firstWhere(
      (id) => id != currentUserId,
      orElse: () => '',
    );
    connectionStats.value = connectionStats.value.copyWith(
      remotePeerId: remotePeerId,
    );

    _loadMessagesFromServer(session);
    _autoConnect(remotePeerId);
  }

  Future<void> _loadMessagesFromServer(ChatSession session) async {
    final sessionUlid = session.id.replaceFirst('session_', '');
    try {
      final response = await _chatApi.getMessages(sessionUlid);
      if (response.messages.isNotEmpty) {
        final loadedMessages = response.messages.map((m) {
          return ChatMessage(
            id: m.ulid,
            sessionId: session.id,
            senderId: m.senderDid,
            content: m.content,
            sentAt: Timestamp.fromDateTime(
              DateTime.fromMillisecondsSinceEpoch(m.sentAt * 1000),
            ),
            type: MessageType.valueOf(m.type) ?? MessageType.MESSAGE_TYPE_TEXT,
            status: MessageStatus.valueOf(m.status) ?? MessageStatus.MESSAGE_STATUS_SENT,
          );
        }).toList();
        loadedMessages.sort((a, b) => a.sentAt.seconds.compareTo(b.sentAt.seconds));
        messages.assignAll(loadedMessages);
        _sessionMessages[session.id] = List<ChatMessage>.from(messages);
      }
    } catch (e) {
      LoggingService.warning('Failed to load messages from server: $e');
    }
  }

  Future<void> _autoConnect(String remotePeerId) async {
    if (remotePeerId.isEmpty) {
      connectionMode.value = ConnectionMode.disconnected;
      connectionStats.value = connectionStats.value.copyWith(
        connectionMode: ConnectionMode.disconnected,
        connectionState: P2PConnectionState.disconnected,
      );
      return;
    }
    
    // Prevent concurrent connection attempts
    if (_isConnecting) {
      LoggingService.info('Already connecting, skipping...');
      return;
    }
    _isConnecting = true;
    
    if (_rtcClient != null) {
      await disconnect();
    }
    
    connectionMode.value = ConnectionMode.disconnected;
    connectionStats.value = connectionStats.value.copyWith(
      connectionMode: ConnectionMode.disconnected,
      connectionState: P2PConnectionState.connecting,
      remotePeerId: remotePeerId,
    );
    
    try {
      // Allow up to 25 seconds for P2P handshake (offer/answer exchange)
      await connect().timeout(
        const Duration(seconds: 25),
        onTimeout: () {
          LoggingService.warning('P2P connection timeout, falling back to relay mode');
          connectionMode.value = ConnectionMode.stationRelay;
          connectionStats.value = connectionStats.value.copyWith(
            connectionMode: ConnectionMode.stationRelay,
            connectionState: P2PConnectionState.failed,
          );
        },
      );
      
      // After connect() completes, check if we actually connected
      // If not, fallback to relay mode (messages will go through station)
      if (connectionMode.value == ConnectionMode.disconnected) {
        connectionMode.value = ConnectionMode.stationRelay;
        connectionStats.value = connectionStats.value.copyWith(
          connectionMode: ConnectionMode.stationRelay,
        );
        LoggingService.info('P2P not established, using station relay mode');
      }
    } catch (e) {
      LoggingService.error('P2P connection failed: $e');
      // Fall back to relay mode instead of disconnected
      connectionMode.value = ConnectionMode.stationRelay;
      connectionStats.value = connectionStats.value.copyWith(
        connectionMode: ConnectionMode.stationRelay,
        connectionState: P2PConnectionState.failed,
      );
    } finally {
      _isConnecting = false;
    }
  }

  void clearError() => error.value = null;

  Future<void> sendMessage(String content) async {
    if (content.trim().isEmpty) return;
    if (currentSession.value == null) return;

    final session = currentSession.value!;
    isSending.value = true;
    clearError();

    try {
      final now = DateTime.now();
      final trimmedContent = content.trim();
      final newMessage = ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        sessionId: session.id,
        senderId: currentUserId,
        content: trimmedContent,
        sentAt: Timestamp.fromDateTime(now),
        type: MessageType.MESSAGE_TYPE_TEXT,
        status: MessageStatus.MESSAGE_STATUS_SENDING,
      );

      messages.add(newMessage);
      _sessionMessages[session.id] = List<ChatMessage>.from(messages);

      final sessionIndex = sessions.indexWhere((s) => s.id == session.id);
      if (sessionIndex != -1) {
        final updatedSession = sessions[sessionIndex].deepCopy()
          ..lastMessageSnippet = trimmedContent
          ..lastMessageAt = Timestamp.fromDateTime(now);
        sessions[sessionIndex] = updatedSession;
        sessions.refresh();
      }

      inputController.clear();
      incrementMessagesSent();

      final remotePeerId = connectionStats.value.remotePeerId;
      final sessionUlid = session.id.replaceFirst('session_', '');

      if (connectionMode.value == ConnectionMode.p2pDirect) {
        _rtcClient!.send(trimmedContent);
        
        newMessage.status = MessageStatus.MESSAGE_STATUS_SENT;
        messages.refresh();
        
        _pendingMessages.add(newMessage);
        connectionStats.value = connectionStats.value.copyWith(
          pendingSyncCount: _pendingMessages.length,
        );

        if (_pendingMessages.length >= _syncMessageThreshold) {
          await _syncPendingMessages();
        }
      } else {
        final response = await _chatApi.sendMessage(
          sessionUlid: sessionUlid,
          receiverDid: remotePeerId,
          content: trimmedContent,
        );

        if (response.deliveryStatus == 'delivered') {
          newMessage.status = MessageStatus.MESSAGE_STATUS_DELIVERED;
          connectionMode.value = ConnectionMode.stationRelay;
          connectionStats.value = connectionStats.value.copyWith(
            connectionMode: ConnectionMode.stationRelay,
          );
        } else {
          newMessage.status = MessageStatus.MESSAGE_STATUS_SENT;
        }
        messages.refresh();
      }
    } catch (e) {
      error.value = 'Failed to send message: $e';
      LoggingService.error('Failed to send message: $e');
    } finally {
      isSending.value = false;
    }
  }

  void createNewSession(String recipientId, String recipientName) {
    final existingSession = sessions.firstWhereOrNull(
      (s) => s.participantIds.contains(recipientId),
    );

    if (existingSession != null) {
      selectSession(existingSession);
      return;
    }

    final now = DateTime.now();
    final newSession = ChatSession(
      id: 'session_${DateTime.now().millisecondsSinceEpoch}',
      topic: recipientName,
      participantIds: [currentUserId, recipientId],
      lastMessageAt: Timestamp.fromDateTime(now),
      type: SessionType.SESSION_TYPE_DIRECT,
    );

    sessions.insert(0, newSession);
    _sessionMessages[newSession.id] = [];
    selectSession(newSession);
  }

  void deleteSession(String sessionId) {
    final index = sessions.indexWhere((s) => s.id == sessionId);
    if (index != -1) {
      sessions.removeAt(index);
      _sessionMessages.remove(sessionId);

      if (currentSession.value?.id == sessionId) {
        if (sessions.isNotEmpty) {
          selectSession(sessions.first);
        } else {
          currentSession.value = null;
          messages.clear();
        }
      }
    }
  }

  void updateConnectionStats(ConnectionStats stats) {
    connectionStats.value = stats;
  }

  String get _signalingUrl => '$_stationBaseUrl/api/v1/ice';

  void refreshConnectionStats() {
    connectionStats.value = connectionStats.value.copyWith(
      signalingUrl: _signalingUrl,
      localPeerId: currentUserId,
    );
  }

  Future<void> connect() async {
    final remotePeerId = connectionStats.value.remotePeerId;
    if (remotePeerId.isEmpty) {
      LoggingService.error('No remote peer selected');
      return;
    }

    connectionStats.value = connectionStats.value.copyWith(
      connectionState: P2PConnectionState.connecting,
      signalingUrl: _signalingUrl,
      localPeerId: currentUserId,
      isRegistered: false,
    );

    try {
      final signaling = RTCSignalingService(_signalingUrl);
      final iceService = IceService(httpService: HttpServiceLocator().httpService);

      // Role is determined automatically based on peer ID comparison
      final role = currentUserId.compareTo(remotePeerId) < 0 ? 'initiator' : 'responder';

      await signaling.registerPeer(currentUserId, role, []);
      connectionStats.value = connectionStats.value.copyWith(isRegistered: true);
      LoggingService.info('Registered peer: $currentUserId as $role');

      _rtcClient = RTCClient(
        signaling,
        role: role,
        peerId: currentUserId,
        iceService: iceService,
      );

      _connectionStateSub = _rtcClient!.onConnectionState.listen((state) {
        LoggingService.info('Connection state: $state');
        connectionStats.value = connectionStats.value.copyWith(
          pcState: state.toString().split('.').last,
        );
        if (state == webrtc.RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
          connectionMode.value = ConnectionMode.p2pDirect;
          connectionStats.value = connectionStats.value.copyWith(
            connectionState: P2PConnectionState.connected,
            connectionMode: ConnectionMode.p2pDirect,
          );
        } else if (state == webrtc.RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            state == webrtc.RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
          connectionMode.value = ConnectionMode.stationRelay;
          connectionStats.value = connectionStats.value.copyWith(
            connectionState: P2PConnectionState.disconnected,
            connectionMode: ConnectionMode.stationRelay,
          );
        }
      });

      _dataChannelStateSub = _rtcClient!.onDataChannelState.listen((state) {
        LoggingService.info('DataChannel state: $state');
        connectionStats.value = connectionStats.value.copyWith(
          dcState: state.toString().split('.').last,
        );
      });

      _messageSub = _rtcClient!.messages().listen((msg) {
        LoggingService.info('Received message: $msg');
        incrementMessagesReceived();
        _handleP2PMessage(msg);
      });

      // Use unified connect() which handles role negotiation automatically
      LoggingService.info('Connecting to peer: $remotePeerId (role=$role)');
      await _rtcClient!.connect(remotePeerId);

      final iceInfo = _rtcClient!.getIceInfo();
      connectionStats.value = connectionStats.value.copyWith(
        iceState: iceInfo['iceConnState']?.toString() ?? 'gathering',
      );

    } catch (e) {
      LoggingService.error('Failed to connect: $e');
      connectionStats.value = connectionStats.value.copyWith(
        connectionState: P2PConnectionState.disconnected,
        iceState: 'error: $e',
      );
    }
  }

  void _handleP2PMessage(String content) {
    if (currentSession.value == null) return;
    final session = currentSession.value!;
    final remotePeerId = connectionStats.value.remotePeerId;

    final now = DateTime.now();
    final newMessage = ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      sessionId: session.id,
      senderId: remotePeerId,
      content: content,
      sentAt: Timestamp.fromDateTime(now),
      type: MessageType.MESSAGE_TYPE_TEXT,
      status: MessageStatus.MESSAGE_STATUS_DELIVERED,
    );

    messages.add(newMessage);
    _sessionMessages[session.id] = List<ChatMessage>.from(messages);

    unawaited(_chatApi.ackMessages([newMessage.id], status: 2).onError((e, _) {
      LoggingService.warning('Failed to ack P2P message: $e');
    }));
  }

  Future<void> disconnect() async {
    _connectionStateSub?.cancel();
    _dataChannelStateSub?.cancel();
    _messageSub?.cancel();
    _rtcClient = null;

    connectionMode.value = ConnectionMode.disconnected;
    connectionStats.value = connectionStats.value.copyWith(
      connectionState: P2PConnectionState.disconnected,
      connectionMode: ConnectionMode.disconnected,
      iceState: 'closed',
      pcState: 'closed',
      dcState: 'closed',
      isRegistered: false,
    );
  }

  void incrementMessagesSent() {
    connectionStats.value = connectionStats.value.copyWith(
      messagesSent: connectionStats.value.messagesSent + 1,
    );
  }

  void incrementMessagesReceived() {
    connectionStats.value = connectionStats.value.copyWith(
      messagesReceived: connectionStats.value.messagesReceived + 1,
    );
  }
}
