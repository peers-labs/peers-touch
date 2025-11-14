import 'base.dart';

class Message extends BaseEntity {
  final String? sessionId;
  final String? content;
  final String? type; // e.g., text, image, system
  final DateTime? timestamp;
  final Map<String, dynamic>? metadata;

  const Message({
    String? id,
    this.sessionId,
    this.content,
    this.type,
    this.timestamp,
    this.metadata,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
  }) : super(
          id: id,
          createdAt: createdAt,
          updatedAt: updatedAt,
          version: version,
        );

  Message copyWith({
    String? id,
    String? sessionId,
    String? content,
    String? type,
    DateTime? timestamp,
    Map<String, dynamic>? metadata,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
  }) {
    return Message(
      id: id ?? this.id,
      sessionId: sessionId ?? this.sessionId,
      content: content ?? this.content,
      type: type ?? this.type,
      timestamp: timestamp ?? this.timestamp,
      metadata: metadata ?? this.metadata,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      version: version ?? this.version,
    );
  }

  @override
  Map<String, dynamic> toMap() {
    return {
      ...super.toMap(),
      'sessionId': sessionId,
      'content': content,
      'type': type,
      'timestamp': timestamp?.toIso8601String(),
      'metadata': metadata,
    };
  }

  static Message fromMap(Map<String, dynamic> map) {
    return Message(
      id: map['id'] as String?,
      sessionId: map['sessionId'] as String?,
      content: map['content'] as String?,
      type: map['type'] as String?,
      timestamp: map['timestamp'] != null
          ? DateTime.parse(map['timestamp'] as String)
          : null,
      metadata: (map['metadata'] as Map?)?.cast<String, dynamic>(),
      createdAt: map['createdAt'] != null
          ? DateTime.parse(map['createdAt'] as String)
          : null,
      updatedAt: map['updatedAt'] != null
          ? DateTime.parse(map['updatedAt'] as String)
          : null,
      version: map['version'] as int?,
    );
  }
}

class Session extends BaseSyncableEntity {
  final String? title;
  final List<Message> messages;
  final Map<String, dynamic>? settings;

  const Session({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    SyncStatus syncStatus = SyncStatus.pending,
    DateTime? lastSyncedAt,
    String? syncError,
    this.title,
    this.messages = const [],
    this.settings,
  }) : super(
          id: id,
          createdAt: createdAt,
          updatedAt: updatedAt,
          version: version,
          syncStatus: syncStatus,
          lastSyncedAt: lastSyncedAt,
          syncError: syncError,
        );

  Session copyWith({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    SyncStatus? syncStatus,
    DateTime? lastSyncedAt,
    String? syncError,
    String? title,
    List<Message>? messages,
    Map<String, dynamic>? settings,
  }) {
    return Session(
      id: id ?? this.id,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      version: version ?? this.version,
      syncStatus: syncStatus ?? this.syncStatus,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      syncError: syncError ?? this.syncError,
      title: title ?? this.title,
      messages: messages ?? this.messages,
      settings: settings ?? this.settings,
    );
  }

  Session addMessage(Message message) {
    final updated = List<Message>.from(messages)..add(message);
    return copyWith(messages: updated);
  }

  Message? lastMessage() => messages.isNotEmpty ? messages.last : null;

  int messageCount() => messages.length;

  @override
  Map<String, dynamic> toMap() {
    return {
      ...super.toMap(),
      'title': title,
      'messages': messages.map((m) => m.toMap()).toList(),
      'settings': settings,
    };
  }

  static Session fromMap(Map<String, dynamic> map) {
    return Session(
      id: map['id'] as String?,
      createdAt: map['createdAt'] != null
          ? DateTime.parse(map['createdAt'] as String)
          : null,
      updatedAt: map['updatedAt'] != null
          ? DateTime.parse(map['updatedAt'] as String)
          : null,
      version: map['version'] as int?,
      syncStatus: BaseSyncableEntity.parseSyncStatus(map['syncStatus'] as String?),
      lastSyncedAt: map['lastSyncedAt'] != null
          ? DateTime.parse(map['lastSyncedAt'] as String)
          : null,
      syncError: map['syncError'] as String?,
      title: map['title'] as String?,
      messages: (map['messages'] as List?)
              ?.map((m) => Message.fromMap((m as Map).cast<String, dynamic>()))
              .toList() ??
          const [],
      settings: (map['settings'] as Map?)?.cast<String, dynamic>(),
    );
  }
}