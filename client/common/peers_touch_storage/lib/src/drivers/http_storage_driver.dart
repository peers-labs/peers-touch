import 'package:dio/dio.dart' as dio;
import 'package:get/get.dart' hide Response;
import '../models/storage_models.dart';
import '../storage_route_provider.dart';
import 'in_memory_driver.dart';

/// HTTP storage driver using a shared Dio client and route provider.
class HttpStorageDriver implements StorageDriver {
  dio.Dio get _dio => Get.isRegistered<dio.Dio>() ? Get.find<dio.Dio>() : dio.Dio();
  RouteProvider get _routeProvider => Get.find<RouteProvider>();

  @override
  Future<Document> create(String resourceCode, Document doc) async {
    final uri = _routeProvider.resolve(resourceCode);
    final dio.Response resp = await _dio.post(uri.toString(), data: doc);
    return _ensureMap(resp.data);
  }

  @override
  Future<Document?> read(String resourceCode, String id) async {
    final uri = _routeProvider.resolve(resourceCode, id: id);
    final dio.Response resp = await _dio.get(uri.toString());
    final data = resp.data;
    if (data == null) return null;
    return _ensureMap(data);
  }

  @override
  Future<Page<Document>> query(String resourceCode, QueryOptions options) async {
    final uri = _routeProvider.resolve(resourceCode, query: _toQuery(options));
    final dio.Response resp = await _dio.get(uri.toString());
    final data = resp.data;
    if (data is Map<String, dynamic>) {
      final items = (data['items'] as List?)?.map((e) => _ensureMap(e)).toList() ?? const [];
      final page = (data['page'] as int?) ?? options.page;
      final pageSize = (data['pageSize'] as int?) ?? options.pageSize;
      final total = (data['total'] as int?) ?? items.length;
      return Page(items: items.cast<Document>(), page: page, pageSize: pageSize, total: total);
    }
    if (data is List) {
      final items = data.map((e) => _ensureMap(e)).toList();
      return Page(items: items, page: options.page, pageSize: options.pageSize, total: items.length);
    }
    return Page(items: const [], page: options.page, pageSize: options.pageSize, total: 0);
  }

  @override
  Future<Document> update(String resourceCode, String id, Document doc) async {
    final uri = _routeProvider.resolve(resourceCode, id: id);
    final dio.Response resp = await _dio.post(uri.toString(), data: doc, options: dio.Options(method: 'PUT'));
    return _ensureMap(resp.data);
  }

  @override
  Future<void> delete(String resourceCode, String id) async {
    final uri = _routeProvider.resolve(resourceCode, id: id);
    await _dio.post(uri.toString(), options: dio.Options(method: 'DELETE'));
  }

  @override
  Future<List<Document>> batchWrite(String resourceCode, List<Document> docs) async {
    final uri = _routeProvider.resolve(resourceCode, action: 'batch');
    final dio.Response resp = await _dio.post(uri.toString(), data: {
      'items': docs,
    });
    final data = resp.data;
    if (data is List) {
      return data.map((e) => _ensureMap(e)).toList();
    }
    if (data is Map<String, dynamic> && data['items'] is List) {
      return (data['items'] as List).map((e) => _ensureMap(e)).toList();
    }
    return const [];
  }

  Map<String, dynamic> _ensureMap(dynamic v) {
    if (v is Map<String, dynamic>) return v;
    if (v is Map) return Map<String, dynamic>.from(v);
    return {'value': v};
  }

  Map<String, dynamic> _toQuery(QueryOptions options) {
    final q = <String, dynamic>{
      'page': options.page,
      'pageSize': options.pageSize,
    };
    if (options.filter != null) {
      q['filter'] = options.filter;
    }
    return q;
  }
}