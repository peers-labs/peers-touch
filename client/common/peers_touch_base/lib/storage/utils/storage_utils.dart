// 存储工具函数
import 'dart:convert';
import 'dart:math';

import '../entities/base/data_entity.dart';

/// 存储工具类
class StorageUtils {
  /// 生成唯一ID
  static String generateId({String? prefix}) {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final random = Random().nextInt(1000000);
    final id = '${prefix ?? 'id'}_${timestamp}_$random';
    return id;
  }
  
  /// 深度复制Map
  static Map<String, dynamic> deepCopyMap(Map<String, dynamic> map) {
    return json.decode(json.encode(map));
  }
  
  /// 检查实体是否过期
  static bool isEntityExpired(DataEntity entity, {Duration? ttl}) {
    final now = DateTime.now();
    final entityAge = now.difference(entity.createdAt);
    return entityAge > (ttl ?? const Duration(days: 30));
  }
  
  /// 格式化存储大小
  static String formatBytes(int bytes, {int decimals = 2}) {
    if (bytes <= 0) return '0 B';
    const suffixes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    final i = (log(bytes) / log(1024)).floor();
    return '${(bytes / pow(1024, i)).toStringAsFixed(decimals)} ${suffixes[i]}';
  }
  
  /// 验证实体数据
  static List<String> validateEntity(DataEntity entity) {
    final errors = <String>[];
    
    // 检查ID
    if (entity.id.isEmpty) {
      errors.add('Entity ID cannot be empty');
    }
    
    // 检查创建时间
    if (entity.createdAt.isAfter(DateTime.now())) {
      errors.add('Created time cannot be in the future');
    }
    
    // 检查更新时间
    if (entity.updatedAt.isBefore(entity.createdAt)) {
      errors.add('Updated time cannot be before created time');
    }
    
    return errors;
  }
  
  /// 合并实体列表（基于ID去重）
  static List<T> mergeEntityLists<T extends DataEntity>(List<T> list1, List<T> list2) {
    final merged = <T>[...list1];
    final existingIds = list1.map((e) => e.id).toSet();
    
    for (final entity in list2) {
      if (!existingIds.contains(entity.id)) {
        merged.add(entity);
      }
    }
    
    return merged;
  }
  
  /// 过滤实体列表
  static List<T> filterEntities<T extends DataEntity>(
    List<T> entities,
    bool Function(T) predicate,
  ) {
    return entities.where(predicate).toList();
  }
  
  /// 排序实体列表
  static List<T> sortEntities<T extends DataEntity>(
    List<T> entities,
    int Function(T, T) compare,
  ) {
    final sorted = List<T>.from(entities);
    sorted.sort(compare);
    return sorted;
  }
  
  /// 分页实体列表
  static List<T> paginateEntities<T>(
    List<T> entities,
    int page,
    int pageSize,
  ) {
    final start = (page - 1) * pageSize;
    final end = start + pageSize;
    
    if (start >= entities.length) {
      return [];
    }
    
    return entities.sublist(start, end > entities.length ? entities.length : end);
  }
}

/// 存储常量
class StorageConstants {
  static const int defaultPageSize = 20;
  static const int maxPageSize = 100;
  static const Duration defaultCacheTTL = Duration(hours: 1);
  static const Duration defaultSyncInterval = Duration(minutes: 5);
  static const int maxBatchSize = 100;
  
  // 错误消息
  static const String errorEntityNotFound = 'Entity not found';
  static const String errorDuplicateEntity = 'Entity already exists';
  static const String errorInvalidData = 'Invalid entity data';
  static const String errorStorageFull = 'Storage is full';
  static const String errorNetworkUnavailable = 'Network is unavailable';
  static const String errorSyncConflict = 'Sync conflict detected';
}