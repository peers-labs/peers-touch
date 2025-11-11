import 'package:peers_touch_desktop/core/models/storage_models.dart';

/// 存储驱动抽象（纯资源码 + 文档）
abstract class StorageDriver {
  Future<Map<String, dynamic>> create(String resourceCode, Map<String, dynamic> payload);

  Future<Map<String, dynamic>?> read(String resourceCode, String id);

  Future<Page<Map<String, dynamic>>> query(
    String resourceCode, {
    QueryOptions? options,
  });

  Future<Map<String, dynamic>> update(String resourceCode, String id, Map<String, dynamic> payload);

  Future<void> delete(String resourceCode, String id);

  Future<List<Map<String, dynamic>>> batchWrite(String resourceCode, List<Map<String, dynamic>> items);
}