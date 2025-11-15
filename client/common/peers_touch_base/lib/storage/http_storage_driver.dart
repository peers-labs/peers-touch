import 'package:dio/dio.dart' as dio;
import 'package:get/get.dart' hide Response;
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';

/// HTTP 存储驱动（复用全局 ApiClient 的拦截器）
class HttpStorageDriver implements StorageDriver {
  ApiClient get _apiClient => Get.find<ApiClient>();
  RouteProvider get _routeProvider => Get.find<RouteProvider>();

  @override
  Future<Map<String, dynamic>> create(String resourceCode, Map<String, dynamic> payload) async {
    final uri = _routeProvider.resolve(resourceCode);
    final dio.Response resp = await _apiClient.post(uri.toString(), data: payload);
    return _ensureMap(resp.data);
  }

  @override
  Future<Map<String, dynamic>?> read(String resourceCode, String id) async {
    final uri = _routeProvider.resolve(resourceCode, id: id);
    final dio.Response resp = await _apiClient.get(uri.toString());
    final data = resp.data;
    if (data == null) return null;
    return _ensureMap(data);
  }

  @override
  Future<Page<Map<String, dynamic>>> query(String resourceCode, {QueryOptions? options}) async {
    final uri = _routeProvider.resolve(resourceCode, query: options?.toQuery());
    final dio.Response resp = await _apiClient.get(uri.toString());
    final data = resp.data;
    if (data is Map<String, dynamic>) {
      // 支持 { items, page, pageSize, total } 格式
      final items = (data['items'] as List?)?.map((e) => _ensureMap(e)).toList() ?? const [];
      final page = (data['page'] as int?) ?? (options?.page ?? 1);
      final pageSize = (data['pageSize'] as int?) ?? (options?.pageSize ?? items.length);
      final total = (data['total'] as int?) ?? items.length;
      return Page(items: items.cast<Map<String, dynamic>>(), page: page, pageSize: pageSize, total: total);
    }
    if (data is List) {
      final items = data.map((e) => _ensureMap(e)).toList();
      final page = options?.page ?? 1;
      final pageSize = options?.pageSize ?? items.length;
      return Page(items: items, page: page, pageSize: pageSize, total: items.length);
    }
    // 兜底：无内容
    return Page(items: const [], page: options?.page ?? 1, pageSize: options?.pageSize ?? 0, total: 0);
  }

  @override
  Future<Map<String, dynamic>> update(String resourceCode, String id, Map<String, dynamic> payload) async {
    final uri = _routeProvider.resolve(resourceCode, id: id);
    final dio.Response resp = await _apiClient.post(uri.toString(), data: payload, options: dio.Options(method: 'PUT'));
    return _ensureMap(resp.data);
  }

  @override
  Future<void> delete(String resourceCode, String id) async {
    final uri = _routeProvider.resolve(resourceCode, id: id);
    await _apiClient.post(uri.toString(), options: dio.Options(method: 'DELETE'));
  }

  @override
  Future<List<Map<String, dynamic>>> batchWrite(String resourceCode, List<Map<String, dynamic>> items) async {
    final uri = _routeProvider.resolve(resourceCode, action: 'batch');
    final dio.Response resp = await _apiClient.post(uri.toString(), data: {
      'items': items,
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
}