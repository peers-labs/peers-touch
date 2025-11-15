import 'dart:convert';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/models/storage_models.dart';
import 'package:peers_touch_storage/peers_touch_storage.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';

/// 负责将本地缓存的数据按规则同步到云端
class StorageSyncService {
  final StorageCache _cache = Get.find<StorageCache>();
  final HttpStorageDriver _http = Get.find<HttpStorageDriver>();
  final StorageDriverResolver _resolver = Get.find<StorageDriverResolver>();
  final LocalStorage _localStorage = Get.find<LocalStorage>();

  /// 如果已开启同步，并且当前是 cloud/hybrid 模式，则执行一次全量同步
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
        // 无队列时，尝试将当前索引中的文档按 upsert 方式同步（适用于首次上线）
        if (action == 'upsert') {
          final page = await _http.query(rc, const QueryOptions(page: 1, pageSize: 1));
          // 若服务端为空，可批量上送本地数据（谨慎）——此处不做强策略，交由业务配置控制
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
            // upsert（create/update）统一处理
            // 尝试读取服务端是否已存在，再决定 create 或 update（简化）
            final exists = await _http.read(rc, id);
            if (exists == null) {
              await _http.create(rc, {...data, 'id': id});
            } else {
              await _http.update(rc, id, data);
            }
          }
          await _cache.removePendingOps(rc, id);
        } catch (e) {
          LoggingService.warning('Sync failed for $rc/$id', e);
        }
      }
    }
  }
}