import 'package:get/get.dart';
import 'package:peers_touch_base/context/app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/default_app_lifecycle_orchestrator.dart';
import 'package:peers_touch_base/context/default_global_context.dart';
import 'package:peers_touch_base/context/global_context.dart';
import 'package:peers_touch_base/logger/logging_service.dart';
import 'package:peers_touch_base/network/connectivity_adapter.dart';
import 'package:peers_touch_base/network/default_token_provider.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/network/token_provider.dart';
import 'package:peers_touch_base/repositories/actor_repository.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_base/storage/local_storage_adapter.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_base/storage/secure_storage_adapter.dart';
import 'package:peers_touch_desktop/adapters/connectivity_desktop.dart';
import 'package:peers_touch_desktop/adapters/local_storage_desktop.dart';
import 'package:peers_touch_desktop/adapters/secure_storage_desktop.dart';
import 'package:peers_touch_desktop/core/repositories/actor_repository_desktop.dart';
import 'package:peers_touch_desktop/core/services/network_discovery/libp2p_network_service.dart';
import 'package:peers_touch_desktop/core/services/network_initializer.dart';
import 'package:peers_touch_desktop/core/services/network_status_service.dart';
import 'package:peers_touch_desktop/core/services/oss_service.dart';
import 'package:peers_touch_desktop/features/auth/controller/auth_controller.dart';
import 'package:peers_touch_desktop/features/shared/services/user_status_service.dart';

/// Application dependency injection binding
/// Focuses on GetX dependency injection registration and management
class InitialBinding extends Bindings {
  // Flag to prevent multiple unauthenticated callbacks
  static bool _isHandlingUnauthenticated = false;
  
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

    // Try to get existing TokenProvider first (for hot restart)
    TokenProvider? tokenProvider;
    if (Get.isRegistered<TokenProvider>()) {
      tokenProvider = Get.find<TokenProvider>();
      LoggingService.info('InitialBinding: Reusing existing TokenProvider');
    } else {
      tokenProvider = DefaultTokenProvider(
        secureStorage: Get.find<SecureStorageAdapter>(),
        localStorage: Get.find<LocalStorageAdapter>(),
      );
      Get.put<TokenProvider>(tokenProvider, permanent: true);
      LoggingService.info('InitialBinding: Created new TokenProvider');
    }

    // Setup auth providers for HttpServiceLocator
    // This ensures AuthInterceptor can read tokens from TokenProvider
    NetworkInitializer.setupAuth(
      tokenProvider: tokenProvider,
      onUnauthenticated: () {
        // Prevent multiple simultaneous unauthenticated callbacks
        if (_isHandlingUnauthenticated) {
          LoggingService.debug('Already handling unauthenticated state, ignoring duplicate callback');
          return;
        }
        
        _isHandlingUnauthenticated = true;
        LoggingService.error('Authentication failed: Token invalid or expired');
        
        // Show snackbar with countdown
        int countdown = 3;
        Get.snackbar(
          '登录已过期',
          '将在 $countdown 秒后跳转到登录页...',
          snackPosition: SnackPosition.TOP,
          duration: const Duration(seconds: 3),
          backgroundColor: Get.theme.colorScheme.errorContainer,
          colorText: Get.theme.colorScheme.onErrorContainer,
        );
        
        // Update countdown every second
        Future.delayed(const Duration(seconds: 1), () {
          if (!_isHandlingUnauthenticated) return;
          countdown = 2;
          Get.closeCurrentSnackbar();
          Get.snackbar(
            '登录已过期',
            '将在 $countdown 秒后跳转到登录页...',
            snackPosition: SnackPosition.TOP,
            duration: const Duration(seconds: 2),
            backgroundColor: Get.theme.colorScheme.errorContainer,
            colorText: Get.theme.colorScheme.onErrorContainer,
          );
        });
        
        Future.delayed(const Duration(seconds: 2), () {
          if (!_isHandlingUnauthenticated) return;
          countdown = 1;
          Get.closeCurrentSnackbar();
          Get.snackbar(
            '登录已过期',
            '将在 $countdown 秒后跳转到登录页...',
            snackPosition: SnackPosition.TOP,
            duration: const Duration(seconds: 1),
            backgroundColor: Get.theme.colorScheme.errorContainer,
            colorText: Get.theme.colorScheme.onErrorContainer,
          );
        });
        
        // Navigate to login page after 3 seconds
        Future.delayed(const Duration(seconds: 3), () {
          if (!_isHandlingUnauthenticated) return;
          
          Get.closeCurrentSnackbar();
          
          // Clear user session
          if (Get.isRegistered<GlobalContext>()) {
            Get.find<GlobalContext>().setSession(null);
          }
          if (Get.isRegistered<AuthController>()) {
            Get.find<AuthController>().logout();
          }
          
          // Navigate to login page
          Get.offAllNamed('/login');
          LoggingService.info('Navigated to login page due to token expiration');
          
          // Reset flag after navigation (in case user comes back)
          Future.delayed(const Duration(milliseconds: 500), () {
            _isHandlingUnauthenticated = false;
          });
        });
      },
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
