import 'package:get/get.dart';

import 'package:peers_touch_desktop/core/services/network_initializer.dart';
import 'package:peers_touch_desktop/core/services/network_status_service.dart';
import 'package:peers_touch_desktop/core/services/network_discovery/libp2p_network_service.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_desktop/features/shared/services/user_status_service.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';
import 'package:peers_touch_base/network/connectivity_adapter.dart';
import 'package:peers_touch_desktop/adapters/secure_storage_desktop.dart';
import 'package:peers_touch_desktop/adapters/connectivity_desktop.dart';
import 'package:peers_touch_desktop/adapters/local_storage_desktop.dart';
import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/default_app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_base/repositories/actor_repository.dart';
import 'package:peers_touch_desktop/core/repositories/actor_repository_desktop.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/network/default_token_provider.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

import 'package:peers_touch_desktop/core/services/oss_service.dart';

/// Application dependency injection binding
/// Focuses on GetX dependency injection registration and management
class InitialBinding extends Bindings {
  @override
  void dependencies() {
    _registerStorageServices();
    _registerNetworkServices();
    _registerBusinessServices();
  }

  /// Register storage services
  void _registerStorageServices() {
    Get.put<LocalStorage>(LocalStorage(), permanent: true);
    // Use SecureStorageService interface and implementation from base
    Get.put<SecureStorage>(SecureStorageImpl(), permanent: true);
    Get.put<SecureStorageAdapter>(
      DesktopSecureStorageAdapter(Get.find<SecureStorage>()),
      permanent: true,
    );
    Get.put<LocalStorageAdapter>(
      DesktopLocalStorageAdapter(Get.find<LocalStorage>()),
      permanent: true,
    );
  }

  /// Register network services
  void _registerNetworkServices() {
    Get.put<NetworkStatusService>(NetworkStatusService(), permanent: true);
    Get.put<ConnectivityAdapter>(
      DesktopConnectivityAdapter(Get.find<NetworkStatusService>()),
      permanent: true,
    );
    Get.put<Libp2pNetworkService>(Libp2pNetworkService(), permanent: true);

    Get.put<TokenProvider>(
      DefaultTokenProvider(secureStorage: Get.find<SecureStorageAdapter>()),
      permanent: true,
    );

    NetworkInitializer.setupAuth(
      tokenProvider: Get.find<TokenProvider>(),
      // tokenRefresher: null, // Can be injected when real refresh interface is connected
    );

    Get.put<OssService>(OssService(), permanent: true);
  }

  /// Register business services
  void _registerBusinessServices() {
    Get.put<UserStatusService>(UserStatusService(), permanent: true);
    // Make AuthController permanent to persist user info session state
    Get.put<AuthController>(AuthController(), permanent: true);
    
    Get.put<GlobalContext>(
      DefaultGlobalContext(
        secureStorage: Get.find<SecureStorageAdapter>(),
        connectivity: Get.find<ConnectivityAdapter>(),
        localStorage: Get.find<LocalStorageAdapter>(),
      ),
      permanent: true,
    );
    final gctx = Get.find<GlobalContext>();
    if (gctx is DefaultGlobalContext) {
      gctx.hydrate();
    }
    Get.put<AppLifecycleOrchestrator>(
      DefaultAppLifecycleOrchestrator(
        secureStorage: Get.find<SecureStorageAdapter>(),
        globalContext: Get.find<GlobalContext>(),
      ),
      permanent: true,
    );
    Get.put<ActorRepository>(
      DesktopActorRepository(HttpServiceLocator().httpService),
      permanent: true,
    );
  }
}
