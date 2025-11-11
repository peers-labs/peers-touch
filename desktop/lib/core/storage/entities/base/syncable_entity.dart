import 'package:peers_touch_desktop/core/storage/entities/base/entity_base.dart';

/// 同步状态
enum SyncStatus {
  localOnly, // 仅本地存在
  synced,    // 已同步
  syncing,   // 同步中
  syncFailed, // 同步失败
}

/// 可同步实体接口
abstract class SyncableEntity extends DataEntity {
  SyncStatus get syncStatus;
  DateTime? get lastSyncedAt;
  String? get syncError;

  /// 标记为同步失败
  void markAsSyncFailed(String error);
}