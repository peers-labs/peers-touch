import 'package:drift/drift.dart';

/// 会话表 - 统一存储私聊和群聊会话
class Sessions extends Table {
  /// 会话ID (ULID)
  TextColumn get id => text()();

  /// 会话类型: 1=friend, 2=group
  IntColumn get type => integer()();

  /// 目标ID (好友ID 或 群ID)
  TextColumn get targetId => text()();

  /// 会话标题/名称
  TextColumn get topic => text().nullable()();

  /// 头像URL
  TextColumn get avatarUrl => text().nullable()();

  /// 最后一条消息ID
  TextColumn get lastMessageId => text().nullable()();

  /// 最后一条消息时间 (Unix timestamp ms)
  IntColumn get lastMessageAt => integer().nullable()();

  /// 最后一条消息预览
  TextColumn get lastMessageSnippet => text().nullable()();

  /// 最后一条消息类型
  IntColumn get lastMessageType => integer().nullable()();

  /// 未读消息数
  IntColumn get unreadCount => integer().withDefault(const Constant(0))();

  /// 是否置顶
  BoolColumn get isPinned => boolean().withDefault(const Constant(false))();

  /// 是否静音
  BoolColumn get isMuted => boolean().withDefault(const Constant(false))();

  /// 创建时间
  IntColumn get createdAt => integer().nullable()();

  /// 更新时间
  IntColumn get updatedAt => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};

  @override
  List<String> get customConstraints => [
    'UNIQUE(type, target_id)',
  ];
}
