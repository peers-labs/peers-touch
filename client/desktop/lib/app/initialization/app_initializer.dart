import 'package:flutter/widgets.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';
import 'package:peers_touch_base/storage/config_database.dart';
import 'package:peers_touch_base/storage/file_storage_manager.dart';
import 'package:peers_touch_base/storage/kv/kv_database.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
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

      // Initialize current user from config database
      await _initializeCurrentUser();
      
      // Drift database is lazy loaded, no explicit init needed for LocalStorage
      LoggingService.info('Local storage initialized (lazy)');
      
      // Log application data storage directory
      await _logStorageDirectories();

      // Initialize window manager
      await WindowOptionsManager.initializeWindowManager();
      LoggingService.info('Window manager initialized');

      // Initialize network service only if not already initialized
      // This prevents losing TokenProvider during hot restart
      try {
        final currentBaseUrl = HttpServiceLocator().baseUrl;
        final hasTokenProvider = HttpServiceLocator().tokenProvider != null;
        
        if (currentBaseUrl.isEmpty) {
          // First time initialization - just set base URL
          NetworkInitializer.initialize(baseUrl: 'http://localhost:18080');
          LoggingService.info('Network service initialized with base URL: http://localhost:18080');
        } else if (!hasTokenProvider) {
          // Hot restart case - HttpServiceLocator exists but TokenProvider not set yet
          // Just update base URL, don't recreate the service
          // TokenProvider will be set by InitialBinding.setupAuth()
          LoggingService.info('Network service already exists, skipping re-initialization (waiting for InitialBinding)');
        } else {
          // Normal case - everything is set up
          LoggingService.info('Network service already initialized with base URL: $currentBaseUrl and TokenProvider');
        }
      } catch (_) {
        NetworkInitializer.initialize(baseUrl: 'http://localhost:18080');
        LoggingService.info('Network service initialized with base URL: http://localhost:18080');
      }

      // Set initial route to splash page
      // Splash page will handle auth check and navigation
      _initialRoute = AppRoutes.splash;
      LoggingService.info('Initial route set to Splash page');

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



  Future<void> _initializeCurrentUser() async {
    try {
      final currentUser = await ConfigDatabase().getCurrentUser();
      if (currentUser != null && currentUser.isNotEmpty) {
        KvDatabase.setUserHandle(currentUser);
        SecureStorageImpl.setUserHandle(currentUser);
        LoggingService.info('Current user initialized: $currentUser');
      } else {
        LoggingService.info('No current user found, using default storage');
      }
    } catch (e) {
      LoggingService.error('Failed to initialize current user: $e');
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
