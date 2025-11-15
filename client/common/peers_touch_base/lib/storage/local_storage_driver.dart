import 'package:get/get.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';

/// 纯本地存储驱动（不发网络），基于 StorageCache
class LocalStorageDriver implements StorageDriver {
  StorageCache get _cache => Get.find<StorageCache>();

  @override
  Future<Map<String, dynamic>> create(String resourceCode, Map<String, dynamic> payload) async {
    final id = (payload['id']?.toString()) ?? DateTime.now().millisecondsSinceEpoch.toString();
    await _cache.upsert(resourceCode, id, payload);
    // 记录本地待同步操作
    await _cache.addPendingOp(resourceCode, id, 'upsert', payload);
    return {...payload, 'id': id};
  }

  @override
  Future<void> delete(String resourceCode, String id) async {
    await _cache.delete(resourceCode, id);
    await _cache.addPendingOp(resourceCode, id, 'delete', {'id': id});
  }

  @override
  Future<List<Map<String, dynamic>>> batchWrite(String resourceCode, List<Map<String, dynamic>> items) async {
    for (final item in items) {
      final id = (item['id']?.toString()) ?? DateTime.now().millisecondsSinceEpoch.toString();
      await _cache.upsert(resourceCode, id, item);
      await _cache.addPendingOp(resourceCode, id, 'upsert', item);
    }
    return items;
  }

  @override
  Future<Map<String, dynamic>?> read(String resourceCode, String id) async {
    return _cache.get(resourceCode, id);
  }

  @override
  Future<Page<Map<String, dynamic>>> query(String resourceCode, QueryOptions options) async {
    final list = await _cache.list(resourceCode, page: options.page, pageSize: options.pageSize);
    return Page(items: list, page: options.page, pageSize: options.pageSize, total: list.length);
  }

  @override
  Future<Map<String, dynamic>> update(String resourceCode, String id, Map<String, dynamic> payload) async {
    await _cache.upsert(resourceCode, id, payload);
    await _cache.addPendingOp(resourceCode, id, 'upsert', payload);
    return {...payload, 'id': id};
  }
}