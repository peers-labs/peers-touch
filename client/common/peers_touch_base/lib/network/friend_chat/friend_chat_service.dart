import 'dart:typed_data';

import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class RelayResponse {
  RelayResponse({
    required this.status,
    this.deliveredAt,
    this.forwardedTo,
  });

  factory RelayResponse.fromJson(Map<String, dynamic> json) {
    return RelayResponse(
      status: json['status'] as String? ?? '',
      deliveredAt: json['delivered_at'] as int?,
      forwardedTo: json['forwarded_to'] as String?,
    );
  }

  final String status;
  final int? deliveredAt;
  final String? forwardedTo;
}

class PendingMessage {
  PendingMessage({
    required this.ulid,
    required this.senderDid,
    required this.sessionUlid,
    required this.encryptedPayload,
    required this.createdAt,
  });

  factory PendingMessage.fromJson(Map<String, dynamic> json) {
    return PendingMessage(
      ulid: json['ulid'] as String? ?? '',
      senderDid: json['sender_did'] as String? ?? '',
      sessionUlid: json['session_ulid'] as String? ?? '',
      encryptedPayload: _decodePayload(json['encrypted_payload']),
      createdAt: json['created_at'] as int? ?? 0,
    );
  }

  static Uint8List _decodePayload(dynamic payload) {
    if (payload == null) return Uint8List(0);
    if (payload is List<int>) return Uint8List.fromList(payload);
    if (payload is String) {
      return Uint8List.fromList(payload.codeUnits);
    }
    return Uint8List(0);
  }

  final String ulid;
  final String senderDid;
  final String sessionUlid;
  final Uint8List encryptedPayload;
  final int createdAt;
}

class SessionInfo {
  SessionInfo({
    required this.ulid,
    required this.participantADid,
    required this.participantBDid,
    required this.lastMessageUlid,
    required this.lastMessageAt,
    required this.unreadCount,
  });

  factory SessionInfo.fromJson(Map<String, dynamic> json) {
    return SessionInfo(
      ulid: json['ulid'] as String? ?? '',
      participantADid: json['participant_a_did'] as String? ?? '',
      participantBDid: json['participant_b_did'] as String? ?? '',
      lastMessageUlid: json['last_message_ulid'] as String? ?? '',
      lastMessageAt: json['last_message_at'] as int? ?? 0,
      unreadCount: json['unread_count'] as int? ?? 0,
    );
  }

  final String ulid;
  final String participantADid;
  final String participantBDid;
  final String lastMessageUlid;
  final int lastMessageAt;
  final int unreadCount;
}

class MessageInfo {
  MessageInfo({
    required this.ulid,
    required this.senderDid,
    required this.receiverDid,
    required this.type,
    required this.content,
    required this.status,
    required this.sentAt,
  });

  factory MessageInfo.fromJson(Map<String, dynamic> json) {
    return MessageInfo(
      ulid: json['ulid'] as String? ?? '',
      senderDid: json['sender_did'] as String? ?? '',
      receiverDid: json['receiver_did'] as String? ?? '',
      type: json['type'] as int? ?? 0,
      content: json['content'] as String? ?? '',
      status: json['status'] as int? ?? 0,
      sentAt: json['sent_at'] as int? ?? 0,
    );
  }

  final String ulid;
  final String senderDid;
  final String receiverDid;
  final int type;
  final String content;
  final int status;
  final int sentAt;
}

class GetSessionsResult {
  GetSessionsResult({
    required this.sessions,
    required this.total,
  });

  final List<SessionInfo> sessions;
  final int total;
}

class GetMessagesResult {
  GetMessagesResult({
    required this.messages,
    required this.hasMore,
  });

  final List<MessageInfo> messages;
  final bool hasMore;
}

class FriendChatService {
  final _httpService = HttpServiceLocator().httpService;

  Future<void> goOnline({required String did}) async {
    if (did.isEmpty) {
      throw ArgumentError('did cannot be empty');
    }

    await _httpService.post<Map<String, dynamic>>(
      '/friend-chat/online',
      data: {'did': did},
    );
  }

  Future<void> goOffline({required String did}) async {
    if (did.isEmpty) {
      throw ArgumentError('did cannot be empty');
    }

    await _httpService.post<void>(
      '/friend-chat/offline',
      data: {'did': did},
    );
  }

  Future<RelayResponse> relayMessage({
    required String senderDid,
    required String receiverDid,
    required Uint8List encryptedPayload,
    String? messageUlid,
    String? sessionUlid,
    int? timestamp,
    String? signature,
  }) async {
    if (senderDid.isEmpty || receiverDid.isEmpty) {
      throw ArgumentError('senderDid and receiverDid cannot be empty');
    }
    if (encryptedPayload.isEmpty) {
      throw ArgumentError('encryptedPayload cannot be empty');
    }

    final response = await _httpService.post<Map<String, dynamic>>(
      '/friend-chat/relay',
      data: {
        'message_ulid': messageUlid,
        'sender_did': senderDid,
        'receiver_did': receiverDid,
        'session_ulid': sessionUlid,
        'encrypted_payload': encryptedPayload,
        'timestamp': timestamp ?? DateTime.now().millisecondsSinceEpoch,
        'signature': signature,
      },
    );

    return RelayResponse.fromJson(response);
  }

  Future<List<PendingMessage>> getPendingMessages({required String did}) async {
    if (did.isEmpty) {
      throw ArgumentError('did cannot be empty');
    }

    final response = await _httpService.get<Map<String, dynamic>>(
      '/friend-chat/pending',
      queryParameters: {'did': did},
    );

    final messagesList = response['messages'] as List<dynamic>? ?? [];
    return messagesList
        .whereType<Map<String, dynamic>>()
        .map(PendingMessage.fromJson)
        .toList();
  }

  Future<void> ackMessages({required List<String> ulids}) async {
    if (ulids.isEmpty) {
      throw ArgumentError('ulids cannot be empty');
    }

    await _httpService.post<void>(
      '/friend-chat/ack',
      data: {'ulids': ulids},
    );
  }

  Future<GetSessionsResult> getSessions({required String did}) async {
    if (did.isEmpty) {
      throw ArgumentError('did cannot be empty');
    }

    final response = await _httpService.get<Map<String, dynamic>>(
      '/friend-chat/sessions',
      queryParameters: {'did': did},
    );

    final sessionsList = response['sessions'] as List<dynamic>? ?? [];
    final sessions = sessionsList
        .whereType<Map<String, dynamic>>()
        .map(SessionInfo.fromJson)
        .toList();

    return GetSessionsResult(
      sessions: sessions,
      total: response['total'] as int? ?? sessions.length,
    );
  }

  Future<GetMessagesResult> getMessages({
    required String sessionUlid,
    String? beforeUlid,
  }) async {
    if (sessionUlid.isEmpty) {
      throw ArgumentError('sessionUlid cannot be empty');
    }

    final queryParams = <String, dynamic>{
      'session_ulid': sessionUlid,
    };
    if (beforeUlid != null && beforeUlid.isNotEmpty) {
      queryParams['before_ulid'] = beforeUlid;
    }

    final response = await _httpService.get<Map<String, dynamic>>(
      '/friend-chat/messages',
      queryParameters: queryParams,
    );

    final messagesList = response['messages'] as List<dynamic>? ?? [];
    final messages = messagesList
        .whereType<Map<String, dynamic>>()
        .map(MessageInfo.fromJson)
        .toList();

    return GetMessagesResult(
      messages: messages,
      hasMore: response['has_more'] as bool? ?? false,
    );
  }
}
