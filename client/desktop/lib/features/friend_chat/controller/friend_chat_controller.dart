import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart' as webrtc;
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/ice/ice_service.dart';
import 'package:peers_touch_base/network/rtc/rtc_client.dart';
import 'package:peers_touch_base/network/rtc/rtc_signaling.dart';
import 'package:peers_touch_base/network/social/social_api_service.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/features/friend_chat/widgets/connection_debug_panel.dart';

class FriendChatController extends GetxController {
  final sessions = <ChatSession>[].obs;
  final messages = <ChatMessage>[].obs;
  final currentSession = Rx<ChatSession?>(null);
  final isSending = false.obs;
  final isLoading = false.obs;
  final error = Rx<String?>(null);

  final connectionStats = const ConnectionStats().obs;

  late final TextEditingController inputController = TextEditingController();

  final Map<String, List<ChatMessage>> _sessionMessages = {};

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
    _loadSessionsFromFriends();
  }

  @override
  void onClose() {
    inputController.dispose();
    _connectionStateSub?.cancel();
    _dataChannelStateSub?.cancel();
    _messageSub?.cancel();
    super.onClose();
  }

  Future<void> _loadSessionsFromFriends() async {
    isLoading.value = true;
    error.value = null;

    try {
      final socialApi = SocialApiService();
      final response = await socialApi.getFollowing();
      final followingList = response.following;
      
      LoggingService.info('FriendChatController: Loaded ${followingList.length} following users');

      final now = DateTime.now();
      final sessionList = <ChatSession>[];

      for (final following in followingList) {
        final session = ChatSession(
          id: 'session_${following.actorId}',
          topic: following.displayName.isNotEmpty ? following.displayName : following.username,
          participantIds: [currentUserId, following.actorId],
          lastMessageAt: Timestamp.fromDateTime(now),
          type: SessionType.SESSION_TYPE_DIRECT,
        );
        sessionList.add(session);
        _sessionMessages['session_${following.actorId}'] = [];
      }

      sessions.assignAll(sessionList);

      if (sessionList.isNotEmpty && currentSession.value == null) {
        selectSession(sessionList.first);
      }
    } catch (e) {
      LoggingService.error('Failed to load sessions from following: $e');
      error.value = 'Failed to load chat sessions';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> refreshSessions() async {
    await _loadSessionsFromFriends();
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
      final newMessage = ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        sessionId: session.id,
        senderId: currentUserId,
        content: content.trim(),
        sentAt: Timestamp.fromDateTime(now),
        type: MessageType.MESSAGE_TYPE_TEXT,
        status: MessageStatus.MESSAGE_STATUS_SENT,
      );

      messages.add(newMessage);
      _sessionMessages[session.id] = List<ChatMessage>.from(messages);

      final sessionIndex = sessions.indexWhere((s) => s.id == session.id);
      if (sessionIndex != -1) {
        final updatedSession = sessions[sessionIndex].deepCopy()
          ..lastMessageSnippet = content.trim()
          ..lastMessageAt = Timestamp.fromDateTime(now);
        sessions[sessionIndex] = updatedSession;
        sessions.refresh();
      }

      inputController.clear();
      incrementMessagesSent();
    } catch (e) {
      error.value = 'Failed to send message: $e';
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

  String get _signalingUrl => '$_stationBaseUrl/chat';

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

      await signaling.registerPeer(currentUserId, 'caller', []);
      connectionStats.value = connectionStats.value.copyWith(isRegistered: true);
      LoggingService.info('Registered peer: $currentUserId');

      _rtcClient = RTCClient(
        signaling,
        role: 'caller',
        peerId: currentUserId,
        iceService: iceService,
      );

      _connectionStateSub = _rtcClient!.onConnectionState.listen((state) {
        LoggingService.info('Connection state: $state');
        connectionStats.value = connectionStats.value.copyWith(
          pcState: state.toString().split('.').last,
        );
        if (state == webrtc.RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
          connectionStats.value = connectionStats.value.copyWith(
            connectionState: P2PConnectionState.connected,
          );
        } else if (state == webrtc.RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            state == webrtc.RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
          connectionStats.value = connectionStats.value.copyWith(
            connectionState: P2PConnectionState.disconnected,
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
        _handleIncomingMessage(msg);
      });

      LoggingService.info('Calling remote peer: $remotePeerId');
      await _rtcClient!.call(remotePeerId);

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

  void _handleIncomingMessage(String content) {
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
  }

  Future<void> disconnect() async {
    _connectionStateSub?.cancel();
    _dataChannelStateSub?.cancel();
    _messageSub?.cancel();
    _rtcClient = null;

    connectionStats.value = connectionStats.value.copyWith(
      connectionState: P2PConnectionState.disconnected,
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
