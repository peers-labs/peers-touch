// 基础存储接口
import 'package:peers_touch_desktop/core/models/entity_base.dart';
// 让依赖此接口的模块也能访问 DataEntity 等类型
export 'package:peers_touch_desktop/core/models/entity_base.dart';

/// 查询条件
class QueryCondition {
  final String field;
  final dynamic value;
  final QueryOperator operator;
  
  QueryCondition({
    required this.field,
    required this.value,
    this.operator = QueryOperator.equal,
  });
}

/// 查询参数
class QueryParams {
  final List<QueryCondition> conditions;
  final List<SortCondition> sortConditions;
  final int? limit;
  final int? offset;
  
  QueryParams({
    this.conditions = const [],
    this.sortConditions = const [],
    this.limit,
    this.offset,
  });
}

/// 查询操作符
enum QueryOperator {
  equal,
  notEqual,
  greaterThan,
  lessThan,
  contains,
  startsWith,
  endsWith,
  between,
}

/// 排序方向
enum SortDirection {
  ascending,
  descending,
}

/// 排序条件
class SortCondition {
  final String field;
  final SortDirection direction;
  
  SortCondition({
    required this.field,
    this.direction = SortDirection.ascending,
  });
}

/// 分页参数
class PaginationParams {
  final int page;
  final int pageSize;
  final List<QueryCondition> conditions;
  final List<SortCondition> sortConditions;
  
  const PaginationParams({
    this.page = 1,
    this.pageSize = 20,
    this.conditions = const [],
    this.sortConditions = const [],
  });
  
  int get offset => (page - 1) * pageSize;
}

/// 基础存储操作接口
abstract class BaseStorage<T extends DataEntity> {
  /// 保存实体
  Future<T> save(T entity);
  
  /// 根据ID获取实体
  Future<T?> get(String id);
  
  /// 获取所有实体
  Future<List<T>> getAll();
  
  /// 根据条件查询实体
  Future<List<T>> query(List<QueryCondition> conditions);
  
  /// 分页查询
  Future<List<T>> queryWithPagination({
    List<QueryCondition> conditions = const [],
    List<SortCondition> sortConditions = const [],
    PaginationParams pagination = const PaginationParams(),
  });
  
  /// 使用查询参数查询
  Future<List<T>> queryWithParams(QueryParams params);
  
  /// 删除实体
  Future<bool> delete(String id);
  
  /// 批量删除
  Future<int> deleteBatch(List<String> ids);
  
  /// 清空所有数据
  Future<void> clear();
  
  /// 获取数据数量
  Future<int> count();
  
  /// 监听数据变化
  Stream<List<T>> watch();
  
  /// 监听单个实体变化
  Stream<T?> watchById(String id);
}

/// 存储异常
class StorageException implements Exception {
  final String message;
  final dynamic cause;
  
  StorageException(this.message, [this.cause]);
  
  @override
  String toString() => 'StorageException: $message${cause != null ? ' (cause: $cause)' : ''}';
}