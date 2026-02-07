import 'package:peers_touch_base/model/domain/chat/friend_chat.pb.dart' as fc;
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class FriendChatSession {
  final String ulid;
  final String participantADid;
  final String participantBDid;
  final String lastMessageUlid;
  final int lastMessageAt;
  final int unreadCount;

  FriendChatSession({
    required this.ulid,
    required this.participantADid,
    required this.participantBDid,
    required this.lastMessageUlid,
    required this.lastMessageAt,
    required this.unreadCount,
  });

  factory FriendChatSession.fromJson(Map<String, dynamic> json) {
    return FriendChatSession(
      ulid: json['ulid'] ?? '',
      participantADid: json['participant_a_did'] ?? '',
      participantBDid: json['participant_b_did'] ?? '',
      lastMessageUlid: json['last_message_ulid'] ?? '',
      lastMessageAt: json['last_message_at'] ?? 0,
      unreadCount: json['unread_count'] ?? 0,
    );
  }
}

class FriendChatMessage {
  final String ulid;
  final String senderDid;
  final String receiverDid;
  final int type;
  final String content;
  final int status;
  final int sentAt;

  FriendChatMessage({
    required this.ulid,
    required this.senderDid,
    required this.receiverDid,
    required this.type,
    required this.content,
    required this.status,
    required this.sentAt,
  });

  factory FriendChatMessage.fromJson(Map<String, dynamic> json) {
    return FriendChatMessage(
      ulid: json['ulid'] ?? '',
      senderDid: json['sender_did'] ?? '',
      receiverDid: json['receiver_did'] ?? '',
      type: json['type'] ?? 1,
      content: json['content'] ?? '',
      status: json['status'] ?? 1,
      sentAt: json['sent_at'] ?? 0,
    );
  }
}

class GetSessionsResponse {
  final List<FriendChatSession> sessions;
  final int total;

  GetSessionsResponse({required this.sessions, required this.total});

  factory GetSessionsResponse.fromJson(Map<String, dynamic> json) {
    final sessionsList = (json['sessions'] as List?)
            ?.map((e) => FriendChatSession.fromJson(e as Map<String, dynamic>))
            .toList() ??
        [];
    return GetSessionsResponse(
      sessions: sessionsList,
      total: json['total'] ?? 0,
    );
  }
}

class GetMessagesResponse {
  final List<FriendChatMessage> messages;
  final bool hasMore;

  GetMessagesResponse({required this.messages, required this.hasMore});

  factory GetMessagesResponse.fromJson(Map<String, dynamic> json) {
    final messagesList = (json['messages'] as List?)
            ?.map((e) => FriendChatMessage.fromJson(e as Map<String, dynamic>))
            .toList() ??
        [];
    return GetMessagesResponse(
      messages: messagesList,
      hasMore: json['has_more'] ?? false,
    );
  }
}

class SendMessageResponse {
  final FriendChatMessage message;
  final String deliveryStatus;

  SendMessageResponse({required this.message, required this.deliveryStatus});

  factory SendMessageResponse.fromJson(Map<String, dynamic> json) {
    return SendMessageResponse(
      message: FriendChatMessage.fromJson(json['message'] ?? {}),
      deliveryStatus: json['delivery_status'] ?? 'queued',
    );
  }
}

class CreateSessionResponse {
  final FriendChatSession session;
  final bool created;

  CreateSessionResponse({required this.session, required this.created});

  factory CreateSessionResponse.fromJson(Map<String, dynamic> json) {
    return CreateSessionResponse(
      session: FriendChatSession.fromJson(json['session'] ?? {}),
      created: json['created'] ?? false,
    );
  }
}

class SyncMessagesResponse {
  final int synced;
  final List<String> failed;

  SyncMessagesResponse({required this.synced, required this.failed});

  factory SyncMessagesResponse.fromJson(Map<String, dynamic> json) {
    return SyncMessagesResponse(
      synced: json['synced'] ?? 0,
      failed: List<String>.from(json['failed'] ?? []),
    );
  }
}

class PendingMessage {
  final String ulid;
  final String senderDid;
  final String sessionUlid;
  final List<int> encryptedPayload;
  final int createdAt;

  PendingMessage({
    required this.ulid,
    required this.senderDid,
    required this.sessionUlid,
    required this.encryptedPayload,
    required this.createdAt,
  });

  factory PendingMessage.fromJson(Map<String, dynamic> json) {
    return PendingMessage(
      ulid: json['ulid'] ?? '',
      senderDid: json['sender_did'] ?? '',
      sessionUlid: json['session_ulid'] ?? '',
      encryptedPayload: List<int>.from(json['encrypted_payload'] ?? []),
      createdAt: json['created_at'] ?? 0,
    );
  }
}

class FriendChatApiService {
  IHttpService get _httpService => HttpServiceLocator().httpService;

  Future<CreateSessionResponse> createSession(String participantDid) async {
    final response = await _httpService.postResponse<Map<String, dynamic>>(
      '/friend-chat/session/create',
      data: {'participant_did': participantDid},
    );
    return CreateSessionResponse.fromJson(response.data ?? {});
  }

  Future<GetSessionsResponse> getSessions(String did) async {
    final response = await _httpService.getResponse<Map<String, dynamic>>(
      '/friend-chat/sessions',
      queryParameters: {'did': did},
    );
    return GetSessionsResponse.fromJson(response.data ?? {});
  }

  Future<SendMessageResponse> sendMessage({
    required String sessionUlid,
    required String receiverDid,
    required String content,
    int type = 1,
    String? replyToUlid,
  }) async {
    final response = await _httpService.postResponse<Map<String, dynamic>>(
      '/friend-chat/message/send',
      data: {
        'session_ulid': sessionUlid,
        'receiver_did': receiverDid,
        'type': type,
        'content': content,
        if (replyToUlid != null) 'reply_to_ulid': replyToUlid,
      },
    );
    return SendMessageResponse.fromJson(response.data ?? {});
  }

  /// Sync messages to server (Proto). Request/response use application/protobuf.
  Future<SyncMessagesResponse> syncMessages(fc.SyncMessagesRequest request) async {
    final proto = await _httpService.post<fc.SyncMessagesResponse>(
      '/friend-chat/message/sync',
      data: request,
      fromJson: fc.SyncMessagesResponse.fromBuffer,
    );
    return SyncMessagesResponse(
      synced: proto.synced,
      failed: List<String>.from(proto.failed),
    );
  }

  Future<GetMessagesResponse> getMessages(
    String sessionUlid, {
    String? beforeUlid,
    int limit = 50,
  }) async {
    final response = await _httpService.getResponse<Map<String, dynamic>>(
      '/friend-chat/messages',
      queryParameters: {
        'session_ulid': sessionUlid,
        if (beforeUlid != null) 'before_ulid': beforeUlid,
        'limit': limit,
      },
    );
    return GetMessagesResponse.fromJson(response.data ?? {});
  }

  Future<void> ackMessages(List<String> ulids, {int status = 2}) async {
    await _httpService.postResponse(
      '/friend-chat/message/ack',
      data: {
        'ulids': ulids,
        'status': status,
      },
    );
  }

  Future<void> markOnline(String did) async {
    await _httpService.postResponse(
      '/friend-chat/online',
      data: {'did': did},
    );
  }

  Future<void> markOffline(String did) async {
    await _httpService.postResponse(
      '/friend-chat/offline',
      data: {'did': did},
    );
  }

  Future<List<PendingMessage>> getPendingMessages(String did) async {
    final response = await _httpService.getResponse<Map<String, dynamic>>(
      '/friend-chat/pending',
      queryParameters: {'did': did},
    );
    final messages = (response.data?['messages'] as List?)
            ?.map((e) => PendingMessage.fromJson(e as Map<String, dynamic>))
            .toList() ??
        [];
    return messages;
  }
}
