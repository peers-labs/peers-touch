// 会话数据实体
import 'entity_base.dart';

/// 消息类型枚举
enum MessageType {
  user,
  assistant,
  system
}

/// 消息数据实体
class MessageEntity {
  /// 消息ID
  final String id;
  
  /// 会话ID
  final String sessionId;
  
  /// 消息内容
  final String content;
  
  /// 消息类型
  final MessageType type;
  
  /// 时间戳
  final DateTime timestamp;
  
  /// 元数据
  final Map<String, dynamic> metadata;

  MessageEntity({
    required this.id,
    required this.sessionId,
    required this.content,
    required this.type,
    DateTime? timestamp,
    this.metadata = const {},
  }) : timestamp = timestamp ?? DateTime.now();
  
  /// 转换为Map
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'sessionId': sessionId,
      'content': content,
      'type': type.index,
      'timestamp': timestamp.millisecondsSinceEpoch,
      'metadata': metadata,
    };
  }

  /// 从Map创建实例
  factory MessageEntity.fromMap(Map<String, dynamic> map) {
    return MessageEntity(
      id: map['id'],
      sessionId: map['sessionId'],
      content: map['content'],
      type: MessageType.values[map['type'] ?? 0],
      timestamp: DateTime.fromMillisecondsSinceEpoch(map['timestamp']),
      metadata: Map<String, dynamic>.from(map['metadata'] ?? {}),
    );
  }

  /// 复制方法
  MessageEntity copyWith({
    String? id,
    String? sessionId,
    String? content,
    MessageType? type,
    DateTime? timestamp,
    Map<String, dynamic>? metadata,
  }) {
    return MessageEntity(
      id: id ?? this.id,
      sessionId: sessionId ?? this.sessionId,
      content: content ?? this.content,
      type: type ?? this.type,
      timestamp: timestamp ?? this.timestamp,
      metadata: metadata ?? this.metadata,
    );
  }
}

/// 会话数据实体
class SessionEntity extends BaseSyncableEntity {
  /// 会话标题
  final String title;
  
  /// 消息列表
  final List<MessageEntity> messages;
  
  /// 会话设置
  final Map<String, dynamic> settings;
  
  SessionEntity({
    required super.id,
    required this.title,
    this.messages = const [],
    this.settings = const {},
    super.createdAt,
    super.updatedAt,
    super.version,
    super.syncStatus,
    super.lastSyncedAt,
    super.syncError,
  });

  @override
  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'title': title,
      'messages': messages.map((msg) => msg.toMap()).toList(),
      'settings': settings,
      'createdAt': createdAt.millisecondsSinceEpoch,
      'updatedAt': updatedAt.millisecondsSinceEpoch,
      'version': version,
      'syncStatus': syncStatus.index,
      'lastSyncedAt': lastSyncedAt?.millisecondsSinceEpoch,
      'syncError': syncError,
    };
  }

  /// 从Map创建实例
  factory SessionEntity.fromMap(Map<String, dynamic> map) {
    return SessionEntity(
      id: map['id'],
      title: map['title'],
      messages: (map['messages'] as List?)?.map((msg) => MessageEntity.fromMap(msg)).toList() ?? [],
      settings: Map<String, dynamic>.from(map['settings'] ?? {}),
      createdAt: DateTime.fromMillisecondsSinceEpoch(map['createdAt']),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(map['updatedAt']),
      version: map['version'],
      syncStatus: SyncStatus.values[map['syncStatus'] ?? 0],
      lastSyncedAt: map['lastSyncedAt'] != null 
          ? DateTime.fromMillisecondsSinceEpoch(map['lastSyncedAt'])
          : null,
      syncError: map['syncError'],
    );
  }

  @override
  SessionEntity copyWith({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
  }) {
    return SessionEntity(
      id: id ?? this.id,
      title: title,
      messages: messages,
      settings: settings,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? DateTime.now(),
      version: version ?? this.version + 1,
      syncStatus: syncStatus,
      lastSyncedAt: lastSyncedAt,
      syncError: syncError,
    );
  }

  /// 扩展的复制方法，包含所有字段
  SessionEntity copyWithExtended({
    String? id,
    String? title,
    List<MessageEntity>? messages,
    Map<String, dynamic>? settings,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
    SyncStatus? syncStatus,
    DateTime? lastSyncedAt,
    String? syncError,
  }) {
    return SessionEntity(
      id: id ?? this.id,
      title: title ?? this.title,
      messages: messages ?? this.messages,
      settings: settings ?? this.settings,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? DateTime.now(),
      version: version ?? this.version + 1,
      syncStatus: syncStatus ?? this.syncStatus,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      syncError: syncError ?? this.syncError,
    );
  }

  /// 添加消息
  SessionEntity addMessage(MessageEntity message) {
    return copyWith(
      messages: [...messages, message],
    );
  }
  
  /// 获取最后一条消息
  MessageEntity? get lastMessage => messages.isNotEmpty ? messages.last : null;
  
  /// 消息数量
  int get messageCount => messages.length;
}