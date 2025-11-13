// 基础实体定义

/// 基础数据实体接口
abstract class DataEntity {
  /// 唯一标识符
  String get id;
  
  /// 创建时间
  DateTime get createdAt;
  
  /// 最后更新时间
  DateTime get updatedAt;
  
  /// 数据版本号（用于冲突检测）
  int get version;
  
  /// 转换为Map用于存储
  Map<String, dynamic> toMap();
  
  /// 从Map创建实例
  static T fromMap<T extends DataEntity>(Map<String, dynamic> map) {
    throw UnimplementedError('fromMap must be implemented by subclasses');
  }
  
  /// 复制方法，用于更新
  DataEntity copyWith({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? version,
  });
}

/// 同步状态枚举
enum SyncStatus {
  /// 本地新建，未同步
  localOnly,
  
  /// 已同步到远程
  synced,
  
  /// 同步中
  syncing,
  
  /// 同步失败
  syncFailed,
  
  /// 有冲突需要解决
  conflict
}

/// 可同步实体接口
abstract class SyncableEntity implements DataEntity {
  /// 同步状态
  SyncStatus get syncStatus;
  
  /// 最后同步时间
  DateTime? get lastSyncedAt;
  
  /// 同步错误信息
  String? get syncError;
}

/// 基础实体实现
abstract class BaseEntity implements DataEntity {
  @override
  final String id;
  
  @override
  final DateTime createdAt;
  
  @override
  DateTime updatedAt;
  
  @override
  int version;
  
  BaseEntity({
    required this.id,
    DateTime? createdAt,
    DateTime? updatedAt,
    this.version = 1,
  }) : 
    createdAt = createdAt ?? DateTime.now(),
    updatedAt = updatedAt ?? DateTime.now();
  
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DataEntity &&
          runtimeType == other.runtimeType &&
          id == other.id;

  @override
  int get hashCode => id.hashCode;
  
  @override
  String toString() => '${runtimeType}(id: $id)';
}

/// 可同步基础实体
abstract class BaseSyncableEntity extends BaseEntity implements SyncableEntity {
  @override
  SyncStatus syncStatus;
  
  @override
  DateTime? lastSyncedAt;
  
  @override
  String? syncError;
  
  BaseSyncableEntity({
    required super.id,
    super.createdAt,
    super.updatedAt,
    super.version,
    this.syncStatus = SyncStatus.localOnly,
    this.lastSyncedAt,
    this.syncError,
  });
  
  /// 标记为同步中
  void markAsSyncing() {
    syncStatus = SyncStatus.syncing;
    updatedAt = DateTime.now();
  }
  
  /// 标记为同步成功
  void markAsSynced() {
    syncStatus = SyncStatus.synced;
    lastSyncedAt = DateTime.now();
    syncError = null;
    updatedAt = DateTime.now();
  }
  
  /// 标记为同步失败
  void markAsSyncFailed(String error) {
    syncStatus = SyncStatus.syncFailed;
    syncError = error;
    updatedAt = DateTime.now();
  }
  
  /// 标记为冲突
  void markAsConflict() {
    syncStatus = SyncStatus.conflict;
    updatedAt = DateTime.now();
  }
}