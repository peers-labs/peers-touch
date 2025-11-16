import 'package:peers_touch_mobile/common/init/init_loader_merge.dart';
import 'package:peers_touch_mobile/common/init/init_loader_regions.dart';
import 'package:peers_touch_mobile/common/region/region_manager.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Comprehensive app initialization manager
/// Handles initialization of all loaders and services
class AppInitialization {
  static final AppInitialization _instance = AppInitialization._internal();
  factory AppInitialization() => _instance;
  AppInitialization._internal();

  final List<InitLoader> _loaders = [];
  bool _initialized = false;

  /// Initialize all app components
  Future<void> initialize() async {
    if (_initialized) {
      appLogger.info('App already initialized');
      return;
    }

    try {
      appLogger.info('Starting app initialization...');
      
      // Create and configure loaders
      final regionLoader = DefaultRegionsLoader();
      final mainLoader = DefaultInitLoader(
        regionsLoader: regionLoader,
      );

      // Add loaders to the list
      _loaders.addAll([
        mainLoader,
        // Add more loaders here as needed
      ]);

      // Create merge loader for coordinated initialization
      final mergeLoader = InitLoaderFactory.createMergeLoader(_loaders);
      
      // Initialize all loaders
      await mergeLoader.initialize();
      
      // Initialize region manager (uses the region loader)
      await RegionManager().initialize();
      
      _initialized = true;
      appLogger.info('App initialization completed successfully');
      
    } catch (e) {
      appLogger.error('App initialization failed', e);
      rethrow;
    }
  }

  /// Check if app is initialized
  bool get isInitialized => _initialized;

  /// Get initialization status
  Future<bool> checkInitialization() async {
    return _initialized && RegionManager().isReady;
  }

  /// Refresh all data
  Future<void> refreshAll() async {
    if (!_initialized) {
      await initialize();
      return;
    }
    
    await RegionManager().refreshRegions();
    appLogger.info('All data refreshed');
  }

  /// Get initialization progress (for splash screens)
  Stream<double> get initializationProgress {
    final mergeLoader = InitLoaderFactory.createMergeLoader(_loaders);
    return mergeLoader.progress;
  }
}

/// Global initialization helper
class AppInit {
  static final AppInitialization _initialization = AppInitialization();

  /// Initialize the entire app
  static Future<void> init() async {
    await _initialization.initialize();
  }

  /// Check if ready
  static bool get isReady => _initialization.isInitialized;

  /// Refresh all data
  static Future<void> refresh() async {
    await _initialization.refreshAll();
  }
}