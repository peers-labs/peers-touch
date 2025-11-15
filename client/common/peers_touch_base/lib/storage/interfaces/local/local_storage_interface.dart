// 本地存储接口
import '../base/storage_interface.dart';

/// 本地存储适配器接口
abstract class LocalStorageAdapter<T extends DataEntity> implements BaseStorage<T> {
  /// 存储键前缀
  String get storageKeyPrefix;
  
  /// 批量保存
  Future<List<T>> saveBatch(List<T> entities);
  
  /// 获取存储大小
  Future<int> getStorageSize();
  
  /// 压缩存储（清理过期数据）
  Future<void> compact();
  
  /// 备份数据
  Future<void> backup();
  
  /// 恢复数据
  Future<void> restore();
}

/// 本地存储配置
class LocalStorageConfig {
  /// 存储键前缀
  final String keyPrefix;
  
  /// 最大存储大小（字节）
  final int maxSize;
  
  /// 自动压缩间隔
  final Duration autoCompactInterval;
  
  /// 是否启用加密
  final bool enableEncryption;
  
  const LocalStorageConfig({
    this.keyPrefix = 'app_',
    this.maxSize = 10 * 1024 * 1024, // 10MB
    this.autoCompactInterval = const Duration(days: 7),
    this.enableEncryption = true,
  });
}