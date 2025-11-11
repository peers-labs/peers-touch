// 组合存储接口
import '../base/storage_interface.dart';
import '../local/local_storage_interface.dart';
import '../network/network_storage_interface.dart';

/// 存储优先级
enum StoragePriority {
  offlineFirst,  // 离线优先
  onlineFirst,   // 在线优先
  hybrid         // 混合策略
}

/// 组合存储策略接口
abstract class CompositeStorageStrategy<T extends DataEntity> {
  /// 存储优先级
  StoragePriority get priority;
  
  /// 本地存储适配器
  LocalStorageAdapter<T> get localAdapter;
  
  /// 网络存储适配器
  NetworkStorageAdapter<T> get networkAdapter;
  
  /// 保存数据（根据策略决定存储顺序）
  Future<T> saveWithStrategy(T entity);
  
  /// 获取数据（根据策略决定数据源）
  Future<T?> getWithStrategy(String id);
  
  /// 手动触发同步
  Future<SyncResult> triggerSync();
  
  /// 获取同步状态
  Future<SyncStatus> getSyncStatus();
}

/// 同步状态
class SyncStatus {
  final bool isSyncing;
  final int pendingCount;
  final int failedCount;
  final DateTime? lastSyncTime;
  final String? lastError;
  
  const SyncStatus({
    this.isSyncing = false,
    this.pendingCount = 0,
    this.failedCount = 0,
    this.lastSyncTime,
    this.lastError,
  });
  
  bool get hasPending => pendingCount > 0;
  bool get hasFailed => failedCount > 0;
}

/// 同步结果
class SyncResult {
  final bool success;
  final String? error;
  final int syncedCount;
  final int failedCount;
  final Duration duration;
  
  const SyncResult({
    required this.success,
    this.error,
    required this.syncedCount,
    required this.failedCount,
    required this.duration,
  });
}

/// 组合存储配置
class CompositeStorageConfig {
  /// 存储优先级策略
  final StoragePriority priority;
  
  /// 自动同步开关
  final bool autoSync;
  
  /// 同步间隔
  final Duration syncInterval;
  
  /// 冲突解决策略
  final ConflictResolutionStrategy conflictStrategy;
  
  const CompositeStorageConfig({
    this.priority = StoragePriority.offlineFirst,
    this.autoSync = true,
    this.syncInterval = const Duration(minutes: 5),
    this.conflictStrategy = ConflictResolutionStrategy.localWins,
  });
}

/// 冲突解决策略
enum ConflictResolutionStrategy {
  localWins,     // 本地数据优先
  remoteWins,    // 远程数据优先
  manual,        // 手动解决
  merge          // 合并数据
}