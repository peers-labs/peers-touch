import 'package:flutter/widgets.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import 'package:peers_touch_base/storage/local_storage.dart';
import 'package:peers_touch_desktop/app/routes/app_routes.dart';
import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/core/services/network_initializer.dart';
import 'package:peers_touch_desktop/core/utils/window_options_manager.dart';

/// Application initializer
/// Responsible for managing all asynchronous initialization operations, belongs to application-level core configuration
class AppInitializer {
  
  factory AppInitializer() => _instance;
  
  AppInitializer._internal();
  static final AppInitializer _instance = AppInitializer._internal();
  
  /// Initialization status
  bool _isInitialized = false;
  
  /// Initialization error information
  String? _initializationError;

  /// Calculated initial route based on auth state
  String _initialRoute = AppRoutes.login;
  
  /// Execute application initialization (instance method)
  /// Returns true if initialization is successful, false if failed
  Future<bool> initialize() async {
    try {
      // Ensure Flutter binding is initialized
      WidgetsFlutterBinding.ensureInitialized();

      // Initialize logging system (this is the first initialization step)
      LoggingService.initialize();
      LoggingService.info('Starting application initialization...');

      // Drift database is lazy loaded, no explicit init needed for LocalStorage
      LoggingService.info('Local storage initialized (lazy)');
      
      // Log application data storage directory
      await _logStorageDirectories();

      // Initialize window manager
      await WindowOptionsManager.initializeWindowManager();
      LoggingService.info('Window manager initialized');

      // Initialize network service
      NetworkInitializer.initialize(baseUrl: 'http://localhost:18080');
      LoggingService.info('Network service initialized with base URL: http://localhost:18080');

      await _checkAuthStatus();

      _isInitialized = true;
      LoggingService.info('Application initialization completed successfully');
      return true;
    } catch (e, stackTrace) {
      _initializationError = 'Initialization failed: $e\nStack trace: $stackTrace';
      _isInitialized = false;
      LoggingService.error('Application initialization failed', e, stackTrace);
      return false;
    }
  }
  
  /// Static initialization method - provides convenient usage
  /// Suitable for most scenarios, returns initialization result
  static Future<bool> init() async {
    return await _instance.initialize();
  }
  
  /// Check if already initialized
  bool get isInitialized => _isInitialized;
  
  /// Static method to check if already initialized
  static bool get isAppInitialized => _instance.isInitialized;
  
  /// Get initialization error information
  String? get initializationError => _initializationError;

  /// Get calculated initial route
  String get initialRoute => _initialRoute;
  
  /// Static method to get initialization error information
  static String? get appInitializationError => _instance.initializationError;
  
  /// Reset initialization status (mainly for testing)
  void reset() {
    _isInitialized = false;
    _initializationError = null;
    _initialRoute = AppRoutes.login;
  }
  
  /// Static reset method (mainly for testing)
  static void resetApp() {
    _instance.reset();
  }

  Future<void> _checkAuthStatus() async {
    try {
      final token = await LocalStorage().get<String>('auth_token');
      
      if (token == null || token.isEmpty) {
        _initialRoute = AppRoutes.login;
        LoggingService.info('No auth token found, setting initial route to Login');
        return;
      }

      final isValid = await _verifyTokenWithBackend(token);
      if (isValid) {
        _initialRoute = AppRoutes.shell;
        LoggingService.info('Token valid, setting initial route to Shell');
      } else {
        await _clearAuthData();
        _initialRoute = AppRoutes.login;
        LoggingService.warning('Token invalid or backend unreachable, cleared auth data');
      }
    } catch (e) {
      _initialRoute = AppRoutes.login;
      LoggingService.error('Failed to check auth status: $e');
    }
  }

  Future<bool> _verifyTokenWithBackend(String token) async {
    try {
      final client = HttpServiceLocator().httpService;
      final response = await client.get<dynamic>('/api/v1/session/verify')
        .timeout(const Duration(seconds: 3));
      
      return response.statusCode == 200;
    } catch (e) {
      LoggingService.warning('Token verification failed: $e');
      return false;
    }
  }

  Future<void> _clearAuthData() async {
    try {
      await LocalStorage().remove('auth_token');
      await LocalStorage().remove('refresh_token');
      await LocalStorage().remove('username');
      await LocalStorage().remove('email');
    } catch (e) {
      LoggingService.error('Failed to clear auth data: $e');
    }
  }

  Future<void> _logStorageDirectories() async {
    try {
      final fileStorageManager = FileStorageManager();
      final supportDir = await fileStorageManager.getBaseDirectory(StorageLocation.support);
      final documentsDir = await fileStorageManager.getBaseDirectory(StorageLocation.documents);
      final cacheDir = await fileStorageManager.getBaseDirectory(StorageLocation.cache);
      
      LoggingService.info('Application data storage directories:');
      LoggingService.info('  Support directory: ${supportDir.path}');
      LoggingService.info('  Documents directory: ${documentsDir.path}');
      LoggingService.info('  Cache directory: ${cacheDir.path}');
    } catch (e) {
      LoggingService.error('Failed to log storage directories: $e');
    }
  }
}
