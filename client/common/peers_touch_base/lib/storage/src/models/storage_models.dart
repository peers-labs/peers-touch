import 'package:equatable/equatable.dart';

/// Basic document type represented as a map.
typedef Document = Map<String, dynamic>;

/// Query options for pagination and simple filtering.
class QueryOptions extends Equatable {
  final int page;
  final int pageSize;
  final Map<String, dynamic>? filter;

  const QueryOptions({
    this.page = 1,
    this.pageSize = 20,
    this.filter,
  });

  QueryOptions copyWith({
    int? page,
    int? pageSize,
    Map<String, dynamic>? filter,
  }) {
    return QueryOptions(
      page: page ?? this.page,
      pageSize: pageSize ?? this.pageSize,
      filter: filter ?? this.filter,
    );
  }

  @override
  List<Object?> get props => [page, pageSize, filter];
}

/// Pagination wrapper for query results.
class Page<T> extends Equatable {
  final List<T> items;
  final int page;
  final int pageSize;
  final int total;

  const Page({
    required this.items,
    required this.page,
    required this.pageSize,
    required this.total,
  });

  @override
  List<Object?> get props => [items, page, pageSize, total];
}