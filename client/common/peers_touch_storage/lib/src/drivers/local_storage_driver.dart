import 'package:get/get.dart';
import '../models/storage_models.dart';
import '../storage_cache.dart';
import 'in_memory_driver.dart';

/// Pure local storage driver (no network), backed by StorageCache.
class LocalStorageDriver implements StorageDriver {
  StorageCache get _cache => Get.find<StorageCache>();

  @override
  Future<Document> create(String resourceCode, Document doc) async {
    final id = (doc['id']?.toString()) ?? DateTime.now().millisecondsSinceEpoch.toString();
    await _cache.upsert(resourceCode, id, doc);
    await _cache.addPendingOp(resourceCode, id, 'upsert', doc);
    return {...doc, 'id': id};
  }

  @override
  Future<void> delete(String resourceCode, String id) async {
    await _cache.delete(resourceCode, id);
    await _cache.addPendingOp(resourceCode, id, 'delete', {'id': id});
  }

  @override
  Future<List<Document>> batchWrite(String resourceCode, List<Document> docs) async {
    for (final item in docs) {
      final id = (item['id']?.toString()) ?? DateTime.now().millisecondsSinceEpoch.toString();
      await _cache.upsert(resourceCode, id, item);
      await _cache.addPendingOp(resourceCode, id, 'upsert', item);
    }
    return docs;
  }

  @override
  Future<Document?> read(String resourceCode, String id) async {
    return _cache.get(resourceCode, id);
  }

  @override
  Future<Page<Document>> query(String resourceCode, QueryOptions options) async {
    final list = await _cache.list(resourceCode, page: options.page, pageSize: options.pageSize);
    return Page(items: list, page: options.page, pageSize: options.pageSize, total: list.length);
  }

  @override
  Future<Document> update(String resourceCode, String id, Document doc) async {
    await _cache.upsert(resourceCode, id, doc);
    await _cache.addPendingOp(resourceCode, id, 'upsert', doc);
    return {...doc, 'id': id};
  }
}