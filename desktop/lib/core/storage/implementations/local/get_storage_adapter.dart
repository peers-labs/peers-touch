// GetStorage本地存储适配器实现
import 'package:get_storage/get_storage.dart';
import '../../interfaces/local/local_storage_interface.dart';
import '../../interfaces/base/storage_interface.dart';
import '../../entities/base/data_entity.dart';

/// GetStorage适配器实现
class GetStorageAdapter<T extends DataEntity> implements LocalStorageAdapter<T> {
  final GetStorage _storage;
  final String _keyPrefix;
  final T Function(Map<String, dynamic>) _fromMap;
  
  GetStorageAdapter({
    required String storageKey,
    required T Function(Map<String, dynamic>) fromMap,
    LocalStorageConfig? config,
  }) : 
    _storage = GetStorage(storageKey),
    _keyPrefix = config?.keyPrefix ?? 'app_',
    _fromMap = fromMap;
  
  @override
  String get storageKeyPrefix => _keyPrefix;
  
  String _getKey(String id) => '${_keyPrefix}${T.toString()}_$id';
  String _getListKey() => '${_keyPrefix}${T.toString()}_list';
  
  @override
  Future<T> save(T entity) async {
    try {
      final key = _getKey(entity.id);
      final map = entity.toMap();
      await _storage.write(key, map);
      
      // 更新列表索引
      final List<String> ids = _storage.read(_getListKey()) ?? [];
      if (!ids.contains(entity.id)) {
        ids.add(entity.id);
        await _storage.write(_getListKey(), ids);
      }
      
      return entity;
    } catch (e) {
      throw StorageException('Failed to save entity: ${e.toString()}', e);
    }
  }
  
  @override
  Future<T?> get(String id) async {
    try {
      final key = _getKey(id);
      final map = _storage.read(key);
      if (map == null) return null;
      return _fromMap(Map<String, dynamic>.from(map));
    } catch (e) {
      throw StorageException('Failed to get entity: ${e.toString()}', e);
    }
  }
  
  @override
  Future<List<T>> getAll() async {
    try {
      final List<String> ids = _storage.read(_getListKey()) ?? [];
      final List<T> entities = [];
      
      for (final id in ids) {
        final entity = await get(id);
        if (entity != null) {
          entities.add(entity);
        }
      }
      
      return entities;
    } catch (e) {
      throw StorageException('Failed to get all entities: ${e.toString()}', e);
    }
  }
  
  @override
  Future<List<T>> query(List<QueryCondition> conditions) async {
    final allEntities = await getAll();
    return _filterEntities(allEntities, conditions);
  }
  
  @override
  Future<List<T>> queryWithPagination({
    List<QueryCondition> conditions = const [],
    List<SortCondition> sortConditions = const [],
    PaginationParams pagination = const PaginationParams(),
  }) async {
    var entities = await getAll();
    
    // 过滤
    entities = _filterEntities(entities, conditions);
    
    // 排序
    entities = _sortEntities(entities, sortConditions);
    
    // 分页
    final start = pagination.offset;
    final end = start + pagination.pageSize;
    return entities.sublist(start, end.clamp(0, entities.length));
  }
  
  @override
  Future<List<T>> queryWithParams(QueryParams params) async {
    var entities = await getAll();
    
    // 过滤
    entities = _filterEntities(entities, params.conditions);
    
    // 排序
    entities = _sortEntities(entities, params.sortConditions);
    
    // 分页
    final start = params.offset;
    final end = start + params.limit;
    return entities.sublist(start, end.clamp(0, entities.length));
  }
  
  @override
  Future<bool> delete(String id) async {
    try {
      final key = _getKey(id);
      await _storage.remove(key);
      
      // 从列表索引中移除
      final List<String> ids = _storage.read(_getListKey()) ?? [];
      ids.remove(id);
      await _storage.write(_getListKey(), ids);
      
      return true;
    } catch (e) {
      throw StorageException('Failed to delete entity: ${e.toString()}', e);
    }
  }
  
  @override
  Future<int> deleteBatch(List<String> ids) async {
    int deletedCount = 0;
    for (final id in ids) {
      if (await delete(id)) {
        deletedCount++;
      }
    }
    return deletedCount;
  }
  
  @override
  Future<void> clear() async {
    try {
      await _storage.erase();
    } catch (e) {
      throw StorageException('Failed to clear storage: ${e.toString()}', e);
    }
  }
  
  @override
  Future<int> count() async {
    final List<String> ids = _storage.read(_getListKey()) ?? [];
    return ids.length;
  }
  
  @override
  Stream<List<T>> watch() {
    // GetStorage不支持流式监听，返回一个空流
    return Stream.value([]);
  }
  
  @override
  Stream<T?> watchById(String id) {
    // GetStorage不支持流式监听，返回一个空流
    return Stream.value(null);
  }
  
  @override
  Future<List<T>> saveBatch(List<T> entities) async {
    final List<T> savedEntities = [];
    for (final entity in entities) {
      final saved = await save(entity);
      savedEntities.add(saved);
    }
    return savedEntities;
  }
  
  @override
  Future<int> getStorageSize() async {
    // GetStorage不提供存储大小信息
    return 0;
  }
  
  @override
  Future<void> compact() async {
    // GetStorage自动管理存储，无需手动压缩
  }
  
  @override
  Future<void> backup() async {
    // GetStorage不提供备份功能
  }
  
  @override
  Future<void> restore() async {
    // GetStorage不提供恢复功能
  }
  
  // 辅助方法
  List<T> _filterEntities(List<T> entities, List<QueryCondition> conditions) {
    if (conditions.isEmpty) return entities;
    
    return entities.where((entity) {
      final map = entity.toMap();
      for (final condition in conditions) {
        if (!_matchesCondition(map, condition)) {
          return false;
        }
      }
      return true;
    }).toList();
  }
  
  bool _matchesCondition(Map<String, dynamic> map, QueryCondition condition) {
    final value = map[condition.field];
    if (value == null) return false;
    
    switch (condition.operator) {
      case QueryOperator.equals:
        return value == condition.value;
      case QueryOperator.notEquals:
        return value != condition.value;
      case QueryOperator.greaterThan:
        return value > condition.value;
      case QueryOperator.lessThan:
        return value < condition.value;
      case QueryOperator.contains:
        return value.toString().contains(condition.value.toString());
      case QueryOperator.startsWith:
        return value.toString().startsWith(condition.value.toString());
      case QueryOperator.endsWith:
        return value.toString().endsWith(condition.value.toString());
    }
  }
  
  List<T> _sortEntities(List<T> entities, List<SortCondition> sortBy) {
    if (sortBy.isEmpty) return entities;
    
    entities.sort((a, b) {
      final aMap = a.toMap();
      final bMap = b.toMap();
      
      for (final sortCondition in sortBy) {
        final aValue = aMap[sortCondition.field];
        final bValue = bMap[sortCondition.field];
        
        if (aValue == bValue) continue;
        
        final comparison = _compareValues(aValue, bValue);
        return sortCondition.direction == SortDirection.ascending 
            ? comparison 
            : -comparison;
      }
      
      return 0;
    });
    
    return entities;
  }
  
  int _compareValues(dynamic a, dynamic b) {
    if (a == b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    
    if (a is Comparable && b is Comparable) {
      return a.compareTo(b);
    }
    
    return a.toString().compareTo(b.toString());
  }
}