import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

/// 简化的存储服务，用于测试
class SimpleStorageService {
  final Map<String, Map<String, dynamic>> _storage = {};

  /// 新增
  Future<Map<String, dynamic>> create(String resourceCode, Map<String, dynamic> payload) async {
    final id = _extractId(payload) ?? DateTime.now().millisecondsSinceEpoch.toString();
    final key = '$resourceCode:$id';
    _storage[key] = payload;
    return payload;
  }

  /// 读取单条
  Future<Map<String, dynamic>?> read(String resourceCode, String id) async {
    final key = '$resourceCode:$id';
    return _storage[key];
  }

  /// 查询
  Future<List<Map<String, dynamic>>> query(String resourceCode) async {
    return _storage.entries
        .where((entry) => entry.key.startsWith('$resourceCode:'))
        .map((entry) => entry.value)
        .toList();
  }

  /// 更新
  Future<Map<String, dynamic>> update(String resourceCode, String id, Map<String, dynamic> payload) async {
    final key = '$resourceCode:$id';
    _storage[key] = payload;
    return payload;
  }

  /// 删除
  Future<void> delete(String resourceCode, String id) async {
    final key = '$resourceCode:$id';
    _storage.remove(key);
  }

  String? _extractId(Map<String, dynamic> m) {
    final v = m['id'];
    if (v == null) return null;
    return v.toString();
  }
}