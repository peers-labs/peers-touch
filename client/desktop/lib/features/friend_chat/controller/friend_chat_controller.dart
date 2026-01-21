import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/model/domain/chat/chat.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/features/discovery/controller/discovery_controller.dart';
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

  String get _currentUserId {
    if (!Get.isRegistered<GlobalContext>()) return '';
    final gc = Get.find<GlobalContext>();
    return gc.actorId ?? gc.currentSession?['actorId']?.toString() ?? '';
  }



  @override
  void onInit() {
    super.onInit();
    _loadSessionsFromFriends();
  }

  @override
  void onClose() {
    inputController.dispose();
    super.onClose();
  }

  Future<void> _loadSessionsFromFriends() async {
    isLoading.value = true;
    error.value = null;

    try {
      if (!Get.isRegistered<DiscoveryController>()) {
        LoggingService.warning('DiscoveryController not registered, cannot load friends');
        return;
      }

      final discoveryCtrl = Get.find<DiscoveryController>();

      if (discoveryCtrl.friends.isEmpty) {
        await discoveryCtrl.loadFriends();
      }

      final friendList = discoveryCtrl.friends.toList();
      LoggingService.info('FriendChatController: Loaded ${friendList.length} friends');

      final now = DateTime.now();
      final sessionList = <ChatSession>[];

      for (final friend in friendList) {
        final session = ChatSession(
          id: 'session_${friend.id}',
          topic: friend.name,
          participantIds: [_currentUserId, friend.actorId ?? friend.id],
          lastMessageAt: Timestamp.fromDateTime(now),
          type: SessionType.SESSION_TYPE_DIRECT,
        );
        session.metadata['avatarUrl'] = friend.avatarUrl;
        sessionList.add(session);

        _sessionMessages['session_${friend.id}'] = [];
      }

      sessions.assignAll(sessionList);

      if (sessionList.isNotEmpty && currentSession.value == null) {
        selectSession(sessionList.first);
      }
    } catch (e) {
      LoggingService.error('Failed to load sessions from friends: $e');
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
      (id) => id != _currentUserId,
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
        senderId: _currentUserId,
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

  void createNewSession(String recipientId, String recipientName, {String? avatarUrl}) {
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
      participantIds: [_currentUserId, recipientId],
      lastMessageAt: Timestamp.fromDateTime(now),
      type: SessionType.SESSION_TYPE_DIRECT,
    );
    if (avatarUrl != null && avatarUrl.isNotEmpty) {
      newSession.metadata['avatarUrl'] = avatarUrl;
    }

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

  void refreshConnectionStats() {
    connectionStats.value = connectionStats.value.copyWith(
      signalingUrl: 'http://localhost:18080/chat',
      localPeerId: _currentUserId.isNotEmpty 
          ? _currentUserId 
          : 'desktop-${DateTime.now().millisecondsSinceEpoch % 10000}',
    );
  }

  Future<void> connect() async {
    connectionStats.value = connectionStats.value.copyWith(
      connectionState: P2PConnectionState.connecting,
      signalingUrl: 'http://localhost:18080/chat',
      localPeerId: _currentUserId,
    );

    await Future.delayed(const Duration(seconds: 1));

    connectionStats.value = connectionStats.value.copyWith(
      connectionState: P2PConnectionState.connected,
      iceState: 'connected',
      pcState: 'connected',
      dcState: 'open',
      isRegistered: true,
    );
  }

  Future<void> disconnect() async {
    connectionStats.value = connectionStats.value.copyWith(
      connectionState: P2PConnectionState.disconnected,
      iceState: 'disconnected',
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
