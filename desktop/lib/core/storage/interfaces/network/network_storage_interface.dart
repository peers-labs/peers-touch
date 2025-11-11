// 网络存储接口
import '../base/storage_interface.dart';

/// 网络存储适配器接口
abstract class NetworkStorageAdapter<T extends DataEntity> implements BaseStorage<T> {
  /// 基础URL
  String get baseUrl;
  
  /// 认证令牌
  String? get authToken;
  
  /// 表名映射令牌（用于隐藏真实表名）
  String get tableToken;
  
  /// 批量同步操作
  Future<BatchSyncResult<T>> syncBatch(List<T> entities);
  
  /// 检查连接状态
  Future<bool> checkConnection();
  
  /// 获取同步状态
  Future<SyncStatusReport> getSyncStatus();
  
  /// 设置认证令牌
  void setAuthToken(String token);
  
  /// 清除认证令牌
  void clearAuthToken();
}

/// 批量同步结果
class BatchSyncResult<T extends DataEntity> {
  final List<T> succeeded;
  final List<SyncFailure<T>> failed;
  final List<DataConflict<T>> conflicts;
  
  const BatchSyncResult({
    this.succeeded = const [],
    this.failed = const [],
    this.conflicts = const [],
  });
  
  bool get hasFailures => failed.isNotEmpty || conflicts.isNotEmpty;
}

/// 同步失败信息
class SyncFailure<T extends DataEntity> {
  final T entity;
  final String error;
  final DateTime timestamp;
  
  SyncFailure({
    required this.entity,
    required this.error,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();
}

/// 数据冲突信息
class DataConflict<T extends DataEntity> {
  final T localEntity;
  final T remoteEntity;
  final ConflictType type;
  
  const DataConflict({
    required this.localEntity,
    required this.remoteEntity,
    required this.type,
  });
}

/// 冲突类型
enum ConflictType {
  versionConflict,    // 版本冲突
  deletionConflict,   // 删除冲突
  modificationConflict // 修改冲突
}

/// 同步状态报告
class SyncStatusReport {
  final int totalEntities;
  final int syncedEntities;
  final int pendingEntities;
  final int failedEntities;
  final DateTime lastSyncTime;
  final bool isOnline;
  
  const SyncStatusReport({
    required this.totalEntities,
    required this.syncedEntities,
    required this.pendingEntities,
    required this.failedEntities,
    required this.lastSyncTime,
    required this.isOnline,
  });
  
  double get syncProgress => totalEntities > 0 ? syncedEntities / totalEntities : 1.0;
}

/// 网络存储配置
class NetworkStorageConfig {
  /// 基础URL
  final String baseUrl;
  
  /// 请求超时时间
  final Duration timeout;
  
  /// 最大重试次数
  final int maxRetries;
  
  /// 重试间隔
  final Duration retryInterval;
  
  /// 是否启用压缩
  final bool enableCompression;
  
  const NetworkStorageConfig({
    required this.baseUrl,
    this.timeout = const Duration(seconds: 30),
    this.maxRetries = 3,
    this.retryInterval = const Duration(seconds: 2),
    this.enableCompression = true,
  });
}