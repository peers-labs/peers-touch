import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' as webrtc;
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/friend_chat/friend_chat_api_service.dart';
import 'package:peers_touch_base/network/ice/ice_service.dart';
import 'package:peers_touch_base/network/rtc/rtc_client.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';
import 'package:peers_touch_base/network/social/social_api_service.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
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

  final connectionStats = const ConnectionStats().obs;
  final connectionMode = ConnectionMode.disconnected.obs;

  late final TextEditingController inputController = TextEditingController();

  final Map<String, List<ChatMessage>> _sessionMessages = {};
  final _chatApi = FriendChatApiService();
  final List<ChatMessage> _pendingMessages = [];
  Timer? _syncTimer;

  static const _syncMessageThreshold = 10;
  static const _syncTimeInterval = Duration(seconds: 10);

  RTCClient? _rtcClient;
  StreamSubscription<webrtc.RTCPeerConnectionState>? _connectionStateSub;
  StreamSubscription<webrtc.RTCDataChannelState>? _dataChannelStateSub;
  StreamSubscription<String>? _messageSub;

  String get currentUserId {
    if (!Get.isRegistered<GlobalContext>()) return '';
    final gc = Get.find<GlobalContext>();
    return gc.actorId ?? gc.currentSession?['actorId']?.toString() ?? '';
  }

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



  @override
  void onInit() {
    super.onInit();
    _startSyncTimer();
    _markOnline();
    _loadFriends();
    _loadPendingMessages();
    _registerWithSignaling(); // Register with signaling server immediately
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
    inputController.dispose();
    _connectionStateSub?.cancel();
    _dataChannelStateSub?.cancel();
    _messageSub?.cancel();
    super.onClose();
  }

  void _startSyncTimer() {
    _syncTimer = Timer.periodic(_syncTimeInterval, (_) {
      if (_pendingMessages.isNotEmpty) {
        _syncPendingMessages();
      }
    });
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

  Future<void> _loadFriends() async {
    LoggingService.info('FriendChatController: Loading friends list');
    isLoading.value = true;
    error.value = null;

    try {
      if (currentUserId.isEmpty) {
        LoggingService.error('FriendChatController: Current user ID is empty');
        error.value = 'User not logged in';
        return;
      }

      final socialApi = SocialApiService();
      final response = await socialApi.getFollowing();
      final followingList = response.following;
      
      LoggingService.info('FriendChatController: Loaded ${followingList.length} friends');

      final friendList = followingList.map((f) => FriendItem(
        actorId: f.actorId,
        username: f.username,
        displayName: f.displayName,
        avatarUrl: f.avatarUrl,
      )).toList();

      friends.assignAll(friendList);
    } catch (e, stackTrace) {
      LoggingService.error('FriendChatController: Failed to load friends: $e');
      LoggingService.debug('Stack trace: $stackTrace');
      error.value = 'Failed to load friends: $e';
    } finally {
      isLoading.value = false;
    }
  }

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
      final messagesData = toSync.map((msg) {
        return {
          'ulid': msg.id,
          'session_ulid': msg.sessionId.replaceFirst('session_', ''),
          'receiver_did': connectionStats.value.remotePeerId,
          'type': msg.type.value,
          'content': msg.content,
          'sent_at': msg.sentAt.seconds,
        };
      }).toList();

      final response = await _chatApi.syncMessages(messagesData);
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
    await _loadFriends();
  }

  Future<void> selectFriend(FriendItem friend) async {
    LoggingService.info('FriendChatController: Selecting friend ${friend.name} (${friend.actorId})');
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
      
      selectSession(session);
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
    
    if (_rtcClient != null) {
      await disconnect();
    }
    
    connectionMode.value = ConnectionMode.disconnected;
    connectionStats.value = connectionStats.value.copyWith(
      connectionMode: ConnectionMode.disconnected,
      connectionState: P2PConnectionState.connecting,
    );
    
    try {
      await connect().timeout(
        const Duration(seconds: 10),
        onTimeout: () {
          LoggingService.warning('P2P connection timeout, falling back to disconnected');
          connectionMode.value = ConnectionMode.disconnected;
          connectionStats.value = connectionStats.value.copyWith(
            connectionMode: ConnectionMode.disconnected,
            connectionState: P2PConnectionState.failed,
          );
        },
      );
    } catch (e) {
      LoggingService.error('P2P connection failed: $e');
      connectionMode.value = ConnectionMode.disconnected;
      connectionStats.value = connectionStats.value.copyWith(
        connectionMode: ConnectionMode.disconnected,
        connectionState: P2PConnectionState.failed,
      );
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

      // Determine role based on peer ID comparison
      // Smaller ID is caller, larger ID is callee
      final isCaller = currentUserId.compareTo(remotePeerId) < 0;
      final role = isCaller ? 'caller' : 'callee';

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

      // Call or answer based on role
      if (isCaller) {
        LoggingService.info('Calling remote peer: $remotePeerId (as caller)');
        await _rtcClient!.call(remotePeerId);
      } else {
        LoggingService.info('Waiting for offer from: $remotePeerId (as callee)');
        await _rtcClient!.answer(remotePeerId);
      }

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
