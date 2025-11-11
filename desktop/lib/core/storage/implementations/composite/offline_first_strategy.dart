// 离线优先组合存储策略
import '../../interfaces/composite/composite_storage_interface.dart';
import '../../interfaces/local/local_storage_interface.dart';
import '../../interfaces/network/network_storage_interface.dart';
import '../../interfaces/base/storage_interface.dart';
import '../../entities/base/data_entity.dart';
import '../../entities/base/syncable_entity.dart';

/// 离线优先存储策略
class OfflineFirstStrategy<T extends DataEntity> implements CompositeStorageStrategy<T> {
  @override
  final StoragePriority priority = StoragePriority.offlineFirst;
  
  @override
  final LocalStorageAdapter<T> localAdapter;
  
  @override
  final NetworkStorageAdapter<T> networkAdapter;
  
  final CompositeStorageConfig _config;
  
  OfflineFirstStrategy({
    required this.localAdapter,
    required this.networkAdapter,
    CompositeStorageConfig? config,
  }) : _config = config ?? const CompositeStorageConfig();
  
  @override
  Future<T> saveWithStrategy(T entity) async {
    try {
      // 1. 先保存到本地（确保离线可用）
      final localSaved = await localAdapter.save(entity);
      
      // 2. 尝试同步到网络（异步，不阻塞用户）
      _syncToNetwork(localSaved);
      
      return localSaved;
    } catch (e) {
      throw StorageException('Failed to save entity with offline-first strategy: ${e.toString()}', e);
    }
  }
  
  @override
  Future<T?> getWithStrategy(String id) async {
    try {
      // 1. 先从本地获取（快速响应）
      var entity = await localAdapter.get(id);
      
      if (entity != null) {
        // 2. 检查是否需要从网络更新
        if (_shouldUpdateFromNetwork(entity)) {
          final networkEntity = await _getFromNetwork(id);
          if (networkEntity != null) {
            // 更新本地数据
            await localAdapter.save(networkEntity);
            entity = networkEntity;
          }
        }
        return entity;
      }
      
      // 3. 本地没有，从网络获取
      final networkEntity = await _getFromNetwork(id);
      if (networkEntity != null) {
        // 保存到本地
        await localAdapter.save(networkEntity);
        return networkEntity;
      }
      
      return null;
    } catch (e) {
      throw StorageException('Failed to get entity with offline-first strategy: ${e.toString()}', e);
    }
  }
  
  @override
  Future<SyncResult> triggerSync() async {
    final startTime = DateTime.now();
    int syncedCount = 0;
    int failedCount = 0;
    String? lastError;
    
    try {
      // 获取所有本地数据
      final localEntities = await localAdapter.getAll();
      
      // 过滤需要同步的数据
      final entitiesToSync = localEntities.where((entity) => 
        entity is SyncableEntity && 
        entity.syncStatus != SyncStatus.synced
      ).toList();
      
      // 批量同步
      final result = await networkAdapter.syncBatch(entitiesToSync);
      
      syncedCount = result.succeeded.length;
      failedCount = result.failed.length;
      
      // 更新同步状态
      for (final entity in result.succeeded) {
        if (entity is SyncableEntity) {
          entity.markAsSynced();
          await localAdapter.save(entity);
        }
      }
      
      for (final failure in result.failed) {
        if (failure.entity is SyncableEntity) {
          (failure.entity as SyncableEntity).markAsSyncFailed(failure.error);
          await localAdapter.save(failure.entity);
        }
        lastError = failure.error;
      }
      
      final duration = DateTime.now().difference(startTime);
      return SyncResult(
        success: failedCount == 0,
        error: lastError,
        syncedCount: syncedCount,
        failedCount: failedCount,
        duration: duration,
      );
    } catch (e) {
      final duration = DateTime.now().difference(startTime);
      return SyncResult(
        success: false,
        error: e.toString(),
        syncedCount: syncedCount,
        failedCount: failedCount,
        duration: duration,
      );
    }
  }
  
  @override
  Future<SyncStatus> getSyncStatus() async {
    try {
      final localEntities = await localAdapter.getAll();
      final syncableEntities = localEntities.whereType<SyncableEntity>().toList();
      
      final pendingCount = syncableEntities.where((e) => e.syncStatus == SyncStatus.localOnly).length;
      final failedCount = syncableEntities.where((e) => e.syncStatus == SyncStatus.syncFailed).length;
      
      // 获取最后同步时间
      DateTime? lastSyncTime;
      for (final entity in syncableEntities) {
        if (entity.syncStatus == SyncStatus.synced && entity.lastSyncedAt != null) {
          if (lastSyncTime == null || entity.lastSyncedAt!.isAfter(lastSyncTime)) {
            lastSyncTime = entity.lastSyncedAt;
          }
        }
      }
      
      return SyncStatus(
        isSyncing: false, // 简化实现
        pendingCount: pendingCount,
        failedCount: failedCount,
        lastSyncTime: lastSyncTime,
      );
    } catch (e) {
      return SyncStatus(
        isSyncing: false,
        pendingCount: 0,
        failedCount: 0,
        lastError: e.toString(),
      );
    }
  }
  
  // 私有方法
  void _syncToNetwork(T entity) async {
    try {
      if (entity is SyncableEntity) {
        entity.markAsSyncing();
        await localAdapter.save(entity);
      }
      
      await networkAdapter.save(entity);
      
      if (entity is SyncableEntity) {
        entity.markAsSynced();
        await localAdapter.save(entity);
      }
    } catch (e) {
      if (entity is SyncableEntity) {
        entity.markAsSyncFailed(e.toString());
        await localAdapter.save(entity);
      }
    }
  }
  
  Future<T?> _getFromNetwork(String id) async {
    try {
      return await networkAdapter.get(id);
    } catch (e) {
      // 网络获取失败不影响本地数据
      return null;
    }
  }
  
  bool _shouldUpdateFromNetwork(T entity) {
    if (entity is! SyncableEntity) return false;
    
    // 检查同步状态
    if (entity.syncStatus == SyncStatus.synced) {
      // 检查数据是否过期（简化实现：超过1小时）
      final oneHourAgo = DateTime.now().subtract(const Duration(hours: 1));
      return entity.lastSyncedAt == null || entity.lastSyncedAt!.isBefore(oneHourAgo);
    }
    
    return true;
  }
}