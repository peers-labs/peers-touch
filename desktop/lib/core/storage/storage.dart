// 存储模块主导出文件

// 导出实体层（迁移到 core/models）
export 'package:peers_touch_desktop/core/models/entity_base.dart';
export 'package:peers_touch_desktop/core/models/user_entity.dart';
export 'package:peers_touch_desktop/core/models/session_entity.dart';

// 导出接口层
export 'interfaces/base/storage_interface.dart';
export 'interfaces/local/local_storage_interface.dart';
export 'interfaces/network/network_storage_interface.dart';
export 'interfaces/secure/secure_storage_interface.dart';
export 'interfaces/composite/composite_storage_interface.dart' hide SyncStatus;

// 导出实现层
export 'implementations/local/get_storage_adapter.dart';
export 'implementations/network/http_storage_adapter.dart';
export 'implementations/secure/flutter_secure_storage_adapter.dart';
export 'implementations/composite/offline_first_strategy.dart';

// 导出工厂层
export 'factories/storage_factory.dart';

// 导出工具层
export 'utils/query_builder.dart';
export 'utils/storage_utils.dart';

/// 存储模块版本信息
class StorageModule {
  static const String version = '1.0.0';
  static const String name = 'Peers Touch Storage Module';
  static const String description = 'A clean, modular storage architecture for Flutter desktop applications';
}