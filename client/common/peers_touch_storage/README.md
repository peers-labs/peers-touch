# Peers-touch Storage (Shared Library)

Flutter shared storage library (protocol-only, no app-specific models).

This package consolidates desktop `core/storage` into `common` so both
mobile and desktop reuse the same storage drivers, cache, and services.

## Features
- Generic `Document` + `QueryOptions` + `Page` types
- Drivers: `InMemoryStorageDriver`, `LocalStorageDriver`, `HttpStorageDriver`
- Cache: `StorageCache` (backed by `GetStorage`)
- Resolver: `StorageDriverResolver` (local/cloud/hybrid)
- Route provider: `ConventionalRouteProvider`
- Services: `SimpleStorageService`, `HybridStorageService`

## Integrate into Desktop/Mobile

Add path dependency in your app `pubspec.yaml`:

```
dependencies:
  peers_touch_storage:
    path: ../client/common/peers_touch_storage
```

Then import:

```
import 'package:peers_touch_storage/peers_touch_storage.dart';
```

### Register dependencies (GetX example)
```
// Local key-value storage and cache
Get.put(LocalStorage());
Get.put(StorageCache());

// HTTP client and route provider
Get.put(Dio());
Get.put< RouteProvider >(ConventionalRouteProvider());

// Drivers
Get.put(LocalStorageDriver());
Get.put(HttpStorageDriver());
Get.put(StorageDriverResolver());

// Choose a service
final driver = Get.find<StorageDriverResolver>().currentDriver();
final service = SimpleStorageService(driver); // or HybridStorageService()
```

## Notes
- Protocol-only: this library does not ship app models (e.g. `UserEntity`).
- Desktop/mobile should keep models in their own modules and convert to `Document`.
- As a Flutter package, use `flutter pub get` in apps depending on this library.