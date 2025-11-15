// 查询构建器工具
import '../interfaces/base/storage_interface.dart';

/// 查询构建器
class QueryBuilder<T> {
  final List<QueryCondition> _conditions = [];
  final List<SortCondition> _sortConditions = [];
  int? _limit;
  int? _offset;
  
  /// 添加等于条件
  QueryBuilder<T> whereEqual(String field, dynamic value) {
    _conditions.add(QueryCondition(
      field: field,
      operator: QueryOperator.equal,
      value: value,
    ));
    return this;
  }
  
  /// 添加不等于条件
  QueryBuilder<T> whereNotEqual(String field, dynamic value) {
    _conditions.add(QueryCondition(
      field: field,
      operator: QueryOperator.notEqual,
      value: value,
    ));
    return this;
  }
  
  /// 添加大于条件
  QueryBuilder<T> whereGreaterThan(String field, dynamic value) {
    _conditions.add(QueryCondition(
      field: field,
      operator: QueryOperator.greaterThan,
      value: value,
    ));
    return this;
  }
  
  /// 添加小于条件
  QueryBuilder<T> whereLessThan(String field, dynamic value) {
    _conditions.add(QueryCondition(
      field: field,
      operator: QueryOperator.lessThan,
      value: value,
    ));
    return this;
  }
  
  /// 添加包含条件
  QueryBuilder<T> whereContains(String field, String value) {
    _conditions.add(QueryCondition(
      field: field,
      operator: QueryOperator.contains,
      value: value,
    ));
    return this;
  }
  
  /// 添加范围条件
  QueryBuilder<T> whereBetween(String field, dynamic start, dynamic end) {
    _conditions.add(QueryCondition(
      field: field,
      operator: QueryOperator.between,
      value: [start, end],
    ));
    return this;
  }
  
  /// 添加排序条件
  QueryBuilder<T> orderBy(String field, {bool descending = false}) {
    _sortConditions.add(SortCondition(
      field: field,
      direction: descending ? SortDirection.descending : SortDirection.ascending,
    ));
    return this;
  }
  
  /// 设置限制
  QueryBuilder<T> limit(int limit) {
    _limit = limit;
    return this;
  }
  
  /// 设置偏移
  QueryBuilder<T> offset(int offset) {
    _offset = offset;
    return this;
  }
  
  /// 构建查询参数
  QueryParams build() {
    return QueryParams(
      conditions: _conditions,
      sortConditions: _sortConditions,
      limit: _limit,
      offset: _offset,
    );
  }
  
  /// 构建分页参数
  PaginationParams buildPagination({int page = 1, int pageSize = 20}) {
    return PaginationParams(
      page: page,
      pageSize: pageSize,
      conditions: _conditions,
      sortConditions: _sortConditions,
    );
  }
}

/// 查询工具类
class QueryUtils {
  /// 创建查询构建器
  static QueryBuilder<T> create<T>() {
    return QueryBuilder<T>();
  }
  
  /// 快速创建等于查询
  static QueryParams whereEqual<T>(String field, dynamic value) {
    return QueryBuilder<T>().whereEqual(field, value).build();
  }
  
  /// 快速创建包含查询
  static QueryParams whereContains<T>(String field, String value) {
    return QueryBuilder<T>().whereContains(field, value).build();
  }
  
  /// 快速创建排序查询
  static QueryParams orderBy<T>(String field, {bool descending = false}) {
    return QueryBuilder<T>().orderBy(field, descending: descending).build();
  }
  
  /// 创建分页查询
  static PaginationParams paginate<T>({
    int page = 1,
    int pageSize = 20,
    List<QueryCondition>? conditions,
    List<SortCondition>? sortConditions,
  }) {
    return PaginationParams(
      page: page,
      pageSize: pageSize,
      conditions: conditions ?? [],
      sortConditions: sortConditions ?? [],
    );
  }
}