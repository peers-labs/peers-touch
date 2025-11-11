// HTTP网络存储适配器实现
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../interfaces/network/network_storage_interface.dart';
import '../../interfaces/base/storage_interface.dart';
import '../../entities/base/data_entity.dart';
import '../../entities/base/syncable_entity.dart';

/// HTTP网络存储适配器
class HttpStorageAdapter<T extends DataEntity> implements NetworkStorageAdapter<T> {
  final http.Client _client;
  final NetworkStorageConfig _config;
  final T Function(Map<String, dynamic>) _fromMap;
  
  String? _authToken;
  String _tableToken;
  
  HttpStorageAdapter({
    required NetworkStorageConfig config,
    required T Function(Map<String, dynamic>) fromMap,
    http.Client? client,
  }) : 
    _config = config,
    _fromMap = fromMap,
    _client = client ?? http.Client(),
    _tableToken = _generateTableToken(T.toString());
  
  @override
  String get baseUrl => _config.baseUrl;
  
  @override
  String? get authToken => _authToken;
  
  @override
  String get tableToken => _tableToken;
  
  @override
  Future<T> save(T entity) async {
    try {
      final url = '$_config.baseUrl/$_tableToken';
      final headers = _buildHeaders();
      final body = jsonEncode((entity as DataEntity).toMap());
      
      final response = await _client.post(
        Uri.parse(url),
        headers: headers,
        body: body,
      ).timeout(_config.timeout);
      
      if (response.statusCode == 200 || response.statusCode == 201) {
        final responseData = jsonDecode(response.body);
        return _fromMap(responseData);
      } else {
        throw StorageException('HTTP ${response.statusCode}: ${response.body}');
      }
    } catch (e) {
      throw StorageException('Failed to save entity: ${e.toString()}', e);
    }
  }
  
  @override
  Future<T?> get(String id) async {
    try {
      final url = '$_config.baseUrl/$_tableToken/$id';
      final headers = _buildHeaders();
      
      final response = await _client.get(
        Uri.parse(url),
        headers: headers,
      ).timeout(_config.timeout);
      
      if (response.statusCode == 200) {
        final responseData = jsonDecode(response.body);
        return _fromMap(responseData);
      } else if (response.statusCode == 404) {
        return null;
      } else {
        throw StorageException('HTTP ${response.statusCode}: ${response.body}');
      }
    } catch (e) {
      throw StorageException('Failed to get entity: ${e.toString()}', e);
    }
  }
  
  @override
  Future<List<T>> getAll() async {
    try {
      final url = '$_config.baseUrl/$_tableToken';
      final headers = _buildHeaders();
      
      final response = await _client.get(
        Uri.parse(url),
        headers: headers,
      ).timeout(_config.timeout);
      
      if (response.statusCode == 200) {
        final responseData = jsonDecode(response.body);
        if (responseData is List) {
          return responseData.map((item) => _fromMap(item)).toList();
        } else {
          return [];
        }
      } else {
        throw StorageException('HTTP ${response.statusCode}: ${response.body}');
      }
    } catch (e) {
      throw StorageException('Failed to get all entities: ${e.toString()}', e);
    }
  }
  
  @override
  Future<List<T>> query(List<QueryCondition> conditions) async {
    // 网络查询通常需要特定的API端点
    // 这里简化实现，获取所有数据后在内存中过滤
    final allEntities = await getAll();
    return _filterEntities(allEntities, conditions);
  }
  
  @override
  Future<List<T>> queryWithPagination({
    List<QueryCondition> conditions = const [],
    List<SortCondition> sortConditions = const [],
    PaginationParams pagination = const PaginationParams(),
  }) async {
    // 网络查询通常需要特定的API端点
    // 这里简化实现，获取所有数据后在内存中处理
    var entities = await getAll();
    entities = _filterEntities(entities, conditions);
    entities = _sortEntities(entities, sortConditions);
    
    final start = pagination.offset;
    final end = start + pagination.pageSize;
    return entities.sublist(start, end.clamp(0, entities.length).toInt());
  }
  
  @override
  Future<List<T>> queryWithParams(QueryParams params) async {
    // 网络查询通常需要特定的API端点
    // 这里简化实现，获取所有数据后在内存中处理
    var entities = await getAll();
    entities = _filterEntities(entities, params.conditions);
    entities = _sortEntities(entities, params.sortConditions);
    
    final start = params.offset;
    final end = start + params.limit;
    return entities.sublist(start, end.clamp(0, entities.length));
  }
  
  @override
  Future<bool> delete(String id) async {
    try {
      final url = '$_config.baseUrl/$_tableToken/$id';
      final headers = _buildHeaders();
      
      final response = await _client.delete(
        Uri.parse(url),
        headers: headers,
      ).timeout(_config.timeout);
      
      return response.statusCode == 200 || response.statusCode == 204;
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
    // 网络存储通常不支持清空所有数据
    throw UnsupportedError('Clear operation not supported for network storage');
  }
  
  @override
  Future<int> count() async {
    final entities = await getAll();
    return entities.length;
  }
  
  @override
  Stream<List<T>> watch() {
    // HTTP不支持流式监听
    return Stream.value([]);
  }
  
  @override
  Stream<T?> watchById(String id) {
    // HTTP不支持流式监听
    return Stream.value(null);
  }
  
  @override
  Future<BatchSyncResult<T>> syncBatch(List<T> entities) async {
    final List<T> succeeded = [];
    final List<SyncFailure<T>> failed = [];
    
    for (final entity in entities) {
      try {
        final saved = await save(entity);
        succeeded.add(saved);
      } catch (e) {
        failed.add(SyncFailure(
          entity: entity,
          error: e.toString(),
        ));
      }
    }
    
    return BatchSyncResult(
      succeeded: succeeded,
      failed: failed,
    );
  }
  
  @override
  Future<bool> checkConnection() async {
    try {
      final response = await _client.get(
        Uri.parse('$_config.baseUrl/health'),
      ).timeout(const Duration(seconds: 5));
      
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }
  
  @override
  Future<SyncStatusReport> getSyncStatus() async {
    final isOnline = await checkConnection();
    final entities = await getAll();
    
    return SyncStatusReport(
      totalEntities: entities.length,
      syncedEntities: entities.where((e) => e is SyncableEntity && e.syncStatus == SyncStatus.synced).length,
      pendingEntities: entities.where((e) => e is SyncableEntity && e.syncStatus == SyncStatus.localOnly).length,
      failedEntities: entities.where((e) => e is SyncableEntity && e.syncStatus == SyncStatus.syncFailed).length,
      lastSyncTime: DateTime.now(),
      isOnline: isOnline,
    );
  }
  
  @override
  void setAuthToken(String token) {
    _authToken = token;
  }
  
  @override
  void clearAuthToken() {
    _authToken = null;
  }
  
  // 辅助方法
  Map<String, String> _buildHeaders() {
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    if (_authToken != null) {
      headers['Authorization'] = 'Bearer $_authToken';
    }
    
    return headers;
  }
  
  static String _generateTableToken(String className) {
    // 简单的表名映射，实际项目中应该使用更安全的算法
    final hash = className.hashCode.toRadixString(36);
    return 't_${hash.substring(0, 8)}';
  }
  
  List<T> _filterEntities(List<T> entities, List<QueryCondition> conditions) {
    if (conditions.isEmpty) return entities;
    
    return entities.where((entity) {
      final map = (entity as DataEntity).toMap();
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
      final aMap = (a as DataEntity).toMap();
      final bMap = (b as DataEntity).toMap();
      
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