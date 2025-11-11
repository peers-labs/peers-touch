/// Peers-touch shared storage library
///
/// Provides shared data models and simple storage service for
/// validating storage scenarios across desktop and mobile.

library peers_touch_storage;

// Protocol-level exports only: generic document and query types,
// plus minimal driver & service. No app-specific entity models.
export 'src/models/storage_models.dart';
export 'src/drivers/in_memory_driver.dart';
export 'src/services/simple_storage_service.dart';
// Shared storage components migrated from desktop (protocol-level only)
export 'src/local_storage.dart';
export 'src/storage_cache.dart';
export 'src/storage_route_provider.dart';
export 'src/storage_driver_resolver.dart';
export 'src/secure_storage.dart';
export 'src/drivers/local_storage_driver.dart';
export 'src/drivers/http_storage_driver.dart';
export 'src/services/hybrid_storage_service.dart';
export 'src/services/storage_sync_service.dart';