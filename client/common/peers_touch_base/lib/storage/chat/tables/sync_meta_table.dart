import 'package:drift/drift.dart';

/// 同步元数据表 - 记录各资源的同步进度
class SyncMeta extends Table {
  /// 资源类型: 'session', 'message', 'member', 'announcement', 'sticker'
  TextColumn get resourceType => text()();

  /// 资源ID: session_id, group_id, 或 '*' 表示全局
  TextColumn get resourceId => text()();

  /// 最后同步时间 (Unix timestamp ms)
  IntColumn get lastSyncAt => integer()();

  /// 同步游标 (服务端分页用)
  TextColumn get syncCursor => text().nullable()();

  /// 扩展字段 (JSON)
  TextColumn get extra => text().nullable()();

  @override
  Set<Column> get primaryKey => {resourceType, resourceId};
}
