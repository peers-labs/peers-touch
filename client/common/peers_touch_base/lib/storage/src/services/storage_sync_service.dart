import 'dart:convert';
import 'package:get/get.dart';
import '../models/storage_models.dart';
import '../storage_cache.dart';
import '../drivers/http_storage_driver.dart';
import '../storage_driver_resolver.dart';
import '../local_storage.dart';

/// Synchronizes local cached data to the cloud based on simple rules.
class StorageSyncService {
  final StorageCache _cache = Get.find<StorageCache>();
  final HttpStorageDriver _http = Get.find<HttpStorageDriver>();
  final StorageDriverResolver _resolver = Get.find<StorageDriverResolver>();
  final StorageService _localStorage = Get.find<StorageService>();

  /// If sync is enabled and cloud/hybrid is active, triggers a full sync.
  Future<void> syncAllIfEnabled() async {
    final enabled = _localStorage.get<bool>('settings:storage:sync_enabled') ?? false;
    if (!enabled) return;
    if (!_resolver.isCloudEnabled) return;
    await _syncAll();
  }

  Future<void> _syncAll() async {
    final rulesJson = _localStorage.get<String>('settings:storage:sync_rules') ?? '{}';
    Map<String, dynamic> rules = <String, dynamic>{};
    try {
      rules = jsonDecode(rulesJson) as Map<String, dynamic>;
    } catch (_) {}

    final resources = _cache.getAllResources();
    for (final rc in resources) {
      final rule = rules[rc];
      final enabled = rule is Map<String, dynamic> ? (rule['enabled'] == true) : true;
      final action = rule is Map<String, dynamic> ? (rule['action']?.toString() ?? 'upsert') : 'upsert';
      if (!enabled) continue;

      final ops = _cache.getPendingOps(rc);
      if (ops.isEmpty) {
        // If no pending ops, optionally seed cloud via upsert (first-time rollout)
        if (action == 'upsert') {
          await _http.query(rc, const QueryOptions(page: 1, pageSize: 1));
        }
        continue;
      }

      for (final op in ops) {
        final id = op['id']?.toString();
        final type = op['type']?.toString();
        final data = Map<String, dynamic>.from(op['data'] ?? const {});
        if (id == null || type == null) continue;
        try {
          if (type == 'delete' && (action == 'delete' || action == 'upsert')) {
            await _http.delete(rc, id);
          } else {
            // Unified upsert (create/update)
            final exists = await _http.read(rc, id);
            if (exists == null) {
              await _http.create(rc, {...data, 'id': id});
            } else {
              await _http.update(rc, id, data);
            }
          }
          await _cache.removePendingOps(rc, id);
        } catch (e) {
          // Decoupled logging; apps can hook into this if needed.
          // ignore: avoid_print
          print('Sync failed for $rc/$id: $e');
        }
      }
    }
  }
}