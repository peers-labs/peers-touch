import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';

/// 资源中心存储服务（业务层只传 resourceCode + Map）
class StorageService {
  StorageDriverResolver get _resolver => Get.find<StorageDriverResolver>();
  StorageCache get _local => Get.find<StorageCache>();
  StorageDriver get _driver => _resolver.currentDriver();

  /// 新增（云端优先，成功后写本地）
  Future<Map<String, dynamic>> create(String resourceCode, Map<String, dynamic> payload) async {
    final cloud = await _driver.create(resourceCode, payload);
    final id = _extractId(cloud) ?? _extractId(payload);
    if (id != null) {
      await _local.upsert(resourceCode, id, cloud);
    }
    return cloud;
  }

  /// 读取单条（云端优先，失败回退本地）
  Future<Map<String, dynamic>?> read(String resourceCode, String id) async {
    try {
      final cloud = await _driver.read(resourceCode, id);
      if (cloud != null) {
        await _local.upsert(resourceCode, id, cloud);
        return cloud;
      }
    } catch (e) {
      LoggingService.warning('Read cloud failed for $resourceCode/$id', e);
    }
    return _local.get(resourceCode, id);
  }

  /// 查询（云端优先，落盘索引；失败回退本地列表）
  Future<Page<Map<String, dynamic>>> query(String resourceCode, {QueryOptions? options}) async {
    final opts = options ?? const QueryOptions();
    try {
      final page = await _driver.query(resourceCode, opts);
      // 落盘缓存
      for (final item in page.items) {
        final id = _extractId(item);
        if (id != null) {
          await _local.upsert(resourceCode, id, item);
        }
      }
      return page;
    } catch (e) {
      LoggingService.warning('Query cloud failed for $resourceCode', e);
      final list = await _local.list(resourceCode, page: opts.page, pageSize: opts.pageSize);
      return Page(items: list, page: opts.page, pageSize: opts.pageSize, total: list.length);
    }
  }

  /// 更新（云端成功后写本地）
  Future<Map<String, dynamic>> update(String resourceCode, String id, Map<String, dynamic> payload) async {
    final cloud = await _driver.update(resourceCode, id, payload);
    await _local.upsert(resourceCode, id, cloud);
    return cloud;
  }

  /// 删除（云端成功后删本地）
  Future<void> delete(String resourceCode, String id) async {
    await _driver.delete(resourceCode, id);
    await _local.delete(resourceCode, id);
  }

  /// 批量写入（云端优先，成功后批量更新本地）
  Future<List<Map<String, dynamic>>> batchWrite(String resourceCode, List<Map<String, dynamic>> items) async {
    final cloudItems = await _driver.batchWrite(resourceCode, items);
    for (final item in cloudItems) {
      final id = _extractId(item);
      if (id != null) {
        await _local.upsert(resourceCode, id, item);
      }
    }
    return cloudItems;
  }

  String? _extractId(Map<String, dynamic> m) {
    final v = m['id'];
    if (v == null) return null;
    return v.toString();
  }
}