import 'package:get/get.dart';
import '../models/storage_models.dart';
import '../storage_cache.dart';
import '../storage_driver_resolver.dart';
import '../drivers/in_memory_driver.dart';

/// Hybrid storage service: cloud-first with local fallback and caching.
class HybridStorageService {
  StorageDriverResolver get _resolver => Get.find<StorageDriverResolver>();
  StorageCache get _local => Get.find<StorageCache>();
  StorageDriver get _driver => _resolver.currentDriver();

  Future<Document> create(String resourceCode, Document doc) async {
    final cloud = await _driver.create(resourceCode, doc);
    final id = (cloud['id']?.toString()) ?? (doc['id']?.toString());
    if (id != null) {
      await _local.upsert(resourceCode, id, cloud);
    }
    return cloud;
  }

  Future<Document?> read(String resourceCode, String id) async {
    try {
      final cloud = await _driver.read(resourceCode, id);
      if (cloud != null) {
        await _local.upsert(resourceCode, id, cloud);
        return cloud;
      }
    } catch (_) {
      // swallow and fallback
    }
    return _local.get(resourceCode, id);
  }

  Future<Page<Document>> query(String resourceCode, {QueryOptions options = const QueryOptions()}) async {
    try {
      final page = await _driver.query(resourceCode, options);
      for (final item in page.items) {
        final id = item['id']?.toString();
        if (id != null) {
          await _local.upsert(resourceCode, id, item);
        }
      }
      return page;
    } catch (_) {
      final list = await _local.list(resourceCode, page: options.page, pageSize: options.pageSize);
      return Page(items: list, page: options.page, pageSize: options.pageSize, total: list.length);
    }
  }

  Future<Document> update(String resourceCode, String id, Document doc) async {
    final cloud = await _driver.update(resourceCode, id, doc);
    await _local.upsert(resourceCode, id, cloud);
    return cloud;
  }

  Future<void> delete(String resourceCode, String id) async {
    await _driver.delete(resourceCode, id);
    await _local.delete(resourceCode, id);
  }

  Future<List<Document>> batchWrite(String resourceCode, List<Document> docs) async {
    final cloudItems = await _driver.batchWrite(resourceCode, docs);
    for (final item in cloudItems) {
      final id = item['id']?.toString();
      if (id != null) {
        await _local.upsert(resourceCode, id, item);
      }
    }
    return cloudItems;
  }
}