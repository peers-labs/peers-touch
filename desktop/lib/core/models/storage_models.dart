import 'package:equatable/equatable.dart';

/// 基础文档类型（与业务无关）
class Document extends Equatable {
  final String? id;
  final Map<String, dynamic> data;
  final Map<String, dynamic>? meta;

  const Document({this.id, required this.data, this.meta});

  Map<String, dynamic> toJson() {
    return {
      if (id != null) 'id': id,
      ...data,
      if (meta != null) '_meta': meta,
    };
  }

  static Document fromJson(Map<String, dynamic> json) {
    final id = json['id']?.toString();
    final meta = json['_meta'] is Map<String, dynamic>
        ? Map<String, dynamic>.from(json['_meta'])
        : null;
    final Map<String, dynamic> data = Map<String, dynamic>.from(json);
    data.remove('id');
    data.remove('_meta');
    return Document(id: id, data: data, meta: meta);
  }

  @override
  List<Object?> get props => [id, data, meta];
}

/// 查询参数（分页 + 简单筛选）
class QueryOptions {
  final Map<String, dynamic>? filter;
  final int page;
  final int pageSize;

  const QueryOptions({this.filter, this.page = 1, this.pageSize = 20});

  Map<String, dynamic> toQuery() {
    return {
      'page': page,
      'pageSize': pageSize,
      if (filter != null) ...filter!,
    };
  }
}

/// 分页包装
class Page<T> {
  final List<T> items;
  final int page;
  final int pageSize;
  final int total;

  const Page({required this.items, required this.page, required this.pageSize, required this.total});
}