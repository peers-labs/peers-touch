// 存储工厂类
import '../entities/user/user_entity.dart';
import '../entities/session/session_entity.dart';
import '../interfaces/local/local_storage_interface.dart';
import '../interfaces/network/network_storage_interface.dart';
import '../interfaces/composite/composite_storage_interface.dart';
import '../interfaces/base/storage_interface.dart';
import '../entities/base/data_entity.dart';
import '../implementations/local/get_storage_adapter.dart';
import '../implementations/network/http_storage_adapter.dart';
import '../implementations/composite/offline_first_strategy.dart';

/// 存储工厂
class StorageFactory {
  static final Map<Type, CompositeStorageStrategy> _cache = {};
  
  /// 创建用户存储
  static CompositeStorageStrategy<UserEntity> createUserStorage({
    LocalStorageConfig? localConfig,
    NetworkStorageConfig? networkConfig,
  }) {
    if (_cache.containsKey(UserEntity)) {
      return _cache[UserEntity]! as CompositeStorageStrategy<UserEntity>;
    }
    
    final localAdapter = GetStorageAdapter<UserEntity>(
      storageKey: 'user_storage',
      fromMap: UserEntity.fromMap,
      config: localConfig,
    );
    
    final networkAdapter = HttpStorageAdapter<UserEntity>(
      config: networkConfig ?? const NetworkStorageConfig(baseUrl: 'http://localhost:8080/api'),
      fromMap: UserEntity.fromMap,
    );
    
    final strategy = OfflineFirstStrategy<UserEntity>(
      localAdapter: localAdapter,
      networkAdapter: networkAdapter,
    );
    
    _cache[UserEntity] = strategy;
    return strategy;
  }
  
  /// 创建会话存储
  static CompositeStorageStrategy<SessionEntity> createSessionStorage({
    LocalStorageConfig? localConfig,
    NetworkStorageConfig? networkConfig,
  }) {
    if (_cache.containsKey(SessionEntity)) {
      return _cache[SessionEntity]! as CompositeStorageStrategy<SessionEntity>;
    }
    
    final localAdapter = GetStorageAdapter<SessionEntity>(
      storageKey: 'session_storage',
      fromMap: SessionEntity.fromMap,
      config: localConfig,
    );
    
    final networkAdapter = HttpStorageAdapter<SessionEntity>(
      config: networkConfig ?? const NetworkStorageConfig(baseUrl: 'http://localhost:8080/api'),
      fromMap: SessionEntity.fromMap,
    );
    
    final strategy = OfflineFirstStrategy<SessionEntity>(
      localAdapter: localAdapter,
      networkAdapter: networkAdapter,
    );
    
    _cache[SessionEntity] = strategy;
    return strategy;
  }
  
  /// 创建仅本地存储（无网络同步）
  static LocalStorageAdapter<T> createLocalOnlyStorage<T extends DataEntity>({
    required String storageKey,
    required T Function(Map<String, dynamic>) fromMap,
    LocalStorageConfig? config,
  }) {
    return GetStorageAdapter<T>(
      storageKey: storageKey,
      fromMap: fromMap,
      config: config,
    );
  }
  
  /// 创建仅网络存储（无本地缓存）
  static NetworkStorageAdapter<T> createNetworkOnlyStorage<T extends DataEntity>({
    required NetworkStorageConfig config,
    required T Function(Map<String, dynamic>) fromMap,
  }) {
    return HttpStorageAdapter<T>(
      config: config,
      fromMap: fromMap,
    );
  }
  
  /// 清除缓存
  static void clearCache() {
    _cache.clear();
  }
  
  /// 获取缓存统计
  static Map<String, int> getCacheStats() {
    return {
      'cached_strategies': _cache.length,
    };
  }
}

/// 存储配置管理器
class StorageConfigManager {
  static LocalStorageConfig getDefaultLocalConfig() {
    return const LocalStorageConfig(
      keyPrefix: 'peers_touch_',
      maxSize: 50 * 1024 * 1024, // 50MB
      autoCompactInterval: Duration(days: 1),
      enableEncryption: true,
    );
  }
  
  static NetworkStorageConfig getDefaultNetworkConfig() {
    return const NetworkStorageConfig(
      baseUrl: 'http://localhost:8080/api',
      timeout: Duration(seconds: 30),
      maxRetries: 3,
      retryInterval: Duration(seconds: 2),
      enableCompression: true,
    );
  }
  
  static CompositeStorageConfig getDefaultCompositeConfig() {
    return const CompositeStorageConfig(
      priority: StoragePriority.offlineFirst,
      autoSync: true,
      syncInterval: Duration(minutes: 5),
      conflictStrategy: ConflictResolutionStrategy.localWins,
    );
  }
}