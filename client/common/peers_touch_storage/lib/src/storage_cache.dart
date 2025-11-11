import 'dart:convert';
import 'package:get/get.dart';
import 'local_storage.dart';

/// Lightweight local cache for offline KV and quick queries.
class StorageCache {
  final LocalStorage _storage = Get.find<LocalStorage>();

  String _docKey(String resourceCode, String id) => 'storage:doc:$resourceCode:$id';
  String _indexKey(String resourceCode) => 'storage:index:$resourceCode';
  String _resourcesKey() => 'storage:resources';
  String _opsKey(String resourceCode) => 'storage:ops:$resourceCode';

  Future<void> upsert(String resourceCode, String id, Map<String, dynamic> data) async {
    await _storage.set(_docKey(resourceCode, id), jsonEncode(data));
    final index = await _getIndex(resourceCode);
    if (!index.contains(id)) {
      index.add(id);
      await _storage.set(_indexKey(resourceCode), jsonEncode(index));
    }
    await _trackResource(resourceCode);
  }

  Map<String, dynamic>? get(String resourceCode, String id) {
    final raw = _storage.get<String>(_docKey(resourceCode, id));
    if (raw == null) return null;
    try {
      return Map<String, dynamic>.from(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  Future<List<Map<String, dynamic>>> list(String resourceCode, {int page = 1, int pageSize = 20}) async {
    final idx = await _getIndex(resourceCode);
    if (idx.isEmpty) return const [];
    final start = (page - 1) * pageSize;
    final end = (start + pageSize).clamp(0, idx.length);
    final slice = idx.sublist(start, end);
    return slice.map((id) => get(resourceCode, id)).whereType<Map<String, dynamic>>().toList();
  }

  Future<void> delete(String resourceCode, String id) async {
    await _storage.remove(_docKey(resourceCode, id));
    final idx = await _getIndex(resourceCode);
    idx.remove(id);
    await _storage.set(_indexKey(resourceCode), jsonEncode(idx));
    await _trackResource(resourceCode);
  }

  Future<void> clearResource(String resourceCode) async {
    final idx = await _getIndex(resourceCode);
    for (final id in idx) {
      await _storage.remove(_docKey(resourceCode, id));
    }
    await _storage.remove(_indexKey(resourceCode));
    await _trackResource(resourceCode);
  }

  Future<List<String>> _getIndex(String resourceCode) async {
    final raw = _storage.get<String>(_indexKey(resourceCode));
    if (raw == null) return <String>[];
    try {
      final list = (jsonDecode(raw) as List).map((e) => e.toString()).toList();
      return list;
    } catch (_) {
      return <String>[];
    }
  }

  Future<void> _trackResource(String resourceCode) async {
    final raw = _storage.get<String>(_resourcesKey());
    List<String> resources = <String>[];
    if (raw != null) {
      try {
        resources = (jsonDecode(raw) as List).map((e) => e.toString()).toList();
      } catch (_) {}
    }
    if (!resources.contains(resourceCode)) {
      resources.add(resourceCode);
      await _storage.set(_resourcesKey(), jsonEncode(resources));
    }
  }

  List<String> getAllResources() {
    final raw = _storage.get<String>(_resourcesKey());
    if (raw == null) return <String>[];
    try {
      return (jsonDecode(raw) as List).map((e) => e.toString()).toList();
    } catch (_) {
      return <String>[];
    }
  }

  Future<void> addPendingOp(String resourceCode, String id, String type, Map<String, dynamic> data) async {
    final raw = _storage.get<String>(_opsKey(resourceCode));
    List<Map<String, dynamic>> ops = <Map<String, dynamic>>[];
    if (raw != null) {
      try {
        ops = List<Map<String, dynamic>>.from((jsonDecode(raw) as List).map((e) => Map<String, dynamic>.from(e)));
      } catch (_) {}
    }
    ops.add({'id': id, 'type': type, 'data': data});
    await _storage.set(_opsKey(resourceCode), jsonEncode(ops));
    await _trackResource(resourceCode);
  }

  List<Map<String, dynamic>> getPendingOps(String resourceCode) {
    final raw = _storage.get<String>(_opsKey(resourceCode));
    if (raw == null) return const [];
    try {
      return List<Map<String, dynamic>>.from((jsonDecode(raw) as List).map((e) => Map<String, dynamic>.from(e)));
    } catch (_) {
      return const [];
    }
  }

  Future<void> removePendingOps(String resourceCode, String id) async {
    final raw = _storage.get<String>(_opsKey(resourceCode));
    if (raw == null) return;
    try {
      final ops = List<Map<String, dynamic>>.from((jsonDecode(raw) as List).map((e) => Map<String, dynamic>.from(e)));
      ops.removeWhere((e) => (e['id']?.toString()) == id);
      await _storage.set(_opsKey(resourceCode), jsonEncode(ops));
    } catch (_) {}
  }
}