import 'package:flutter/widgets.dart';
import 'package:flutter/foundation.dart';
import 'package:get_storage/get_storage.dart';
import 'package:logging/logging.dart';

import 'package:peers_touch_desktop/core/services/logging_service.dart';
import 'package:peers_touch_desktop/core/utils/window_options_manager.dart';

/// Application initializer
/// Responsible for managing all asynchronous initialization operations, belongs to application-level core configuration
class AppInitializer {
  static final AppInitializer _instance = AppInitializer._internal();
  
  factory AppInitializer() => _instance;
  
  AppInitializer._internal();
  
  /// Initialization status
  bool _isInitialized = false;
  
  /// Initialization error information
  String? _initializationError;
  
  /// Execute application initialization (instance method)
  /// Returns true if initialization is successful, false if failed
  Future<bool> initialize() async {
    try {
      // Ensure Flutter binding is initialized
      WidgetsFlutterBinding.ensureInitialized();

      // Initialize logging system (this is the first initialization step)
      LoggingService.initialize(level: Level.ALL);
      LoggingService.info('Starting application initialization...');
      
      // Initialize GetStorage
      await GetStorage.init();
      LoggingService.info('Local storage initialized');
      
      // Initialize window manager
      await WindowOptionsManager.initializeWindowManager();
      LoggingService.info('Window manager initialized');
      
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
  
  /// Static method to get initialization error information
  static String? get appInitializationError => _instance.initializationError;
  
  /// Reset initialization status (mainly for testing)
  void reset() {
    _isInitialized = false;
    _initializationError = null;
  }
  
  /// Static reset method (mainly for testing)
  static void resetAppInitializer() {
    _instance.reset();
  }
}