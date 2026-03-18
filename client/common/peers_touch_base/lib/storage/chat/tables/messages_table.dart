import 'package:drift/drift.dart';

/// 消息表 - 存储所有聊天消息
class Messages extends Table {
  /// 消息ID (ULID)
  TextColumn get id => text()();

  /// 所属会话ID
  TextColumn get sessionId => text()();

  /// 发送者ID
  TextColumn get senderId => text()();

  /// 消息类型: 1=text, 2=image, 3=file, 4=location, 5=system, 6=sticker, 7=audio, 8=video
  IntColumn get type => integer()();

  /// 消息内容
  TextColumn get content => text().nullable()();

  /// 加密内容
  TextColumn get encryptedContent => text().nullable()();

  /// 附件 (JSON array)
  TextColumn get attachments => text().nullable()();

  /// 元数据 (JSON object)
  TextColumn get metadata => text().nullable()();

  /// 回复的消息ID (Thread回复)
  TextColumn get replyToId => text().nullable()();

  /// @的用户ID列表 (JSON array)
  TextColumn get mentionedIds => text().nullable()();

  /// 是否@所有人
  BoolColumn get mentionAll => boolean().withDefault(const Constant(false))();

  /// 消息状态: 0=unknown, 1=sending, 2=sent, 3=delivered, 4=failed
  IntColumn get status => integer().withDefault(const Constant(0))();

  /// 是否已删除
  BoolColumn get isDeleted => boolean().withDefault(const Constant(false))();

  /// 删除时间
  IntColumn get deletedAt => integer().nullable()();

  /// 发送时间 (Unix timestamp ms)
  IntColumn get sentAt => integer()();

  /// 本地创建时间
  IntColumn get createdAt => integer().nullable()();

  @override
  Set<Column> get primaryKey => {id};
}
