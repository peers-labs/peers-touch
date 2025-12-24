import 'package:flutter/widgets.dart';
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

      // Initialize window manager
      await WindowOptionsManager.initializeWindowManager();
      LoggingService.info('Window manager initialized');

      // Initialize network service
      NetworkInitializer.initialize(baseUrl: 'http://localhost:18080');
      LoggingService.info('Network service initialized with base URL: http://localhost:18080');



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
  static void resetAppInitializer() {
    _instance.reset();
  }
}
