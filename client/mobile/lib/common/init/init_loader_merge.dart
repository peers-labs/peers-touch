import 'dart:async';
import 'init_loader_regions.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Initialization status enum
enum InitStatus {
  notStarted,
  inProgress,
  completed,
  failed
}

/// Base initialization loader class
abstract class InitLoader {
  /// Initialize the application
  Future<void> initialize();
  
  /// Get current initialization status
  InitStatus get status;
  
  /// Check if initialization is complete
  bool get isInitialized;
  
  /// Get initialization progress
  Stream<double> get progress;
}

/// Configuration for initialization
class InitConfig {
  final bool debugMode;
  final Duration timeout;
  final List<String> preloadImagePaths;
  
  const InitConfig({
    this.debugMode = false,
    this.timeout = const Duration(seconds: 30),
    this.preloadImagePaths = const [],
  });
}

/// Default implementation of InitLoader
class DefaultInitLoader extends InitLoader with RegionsLoaderMixin {
  final InitConfig _config;
  final RegionsLoader _regionsLoader;
  final StreamController<double> _progressController = StreamController<double>.broadcast();
  InitStatus _status = InitStatus.notStarted;
  
  DefaultInitLoader({
    InitConfig? config,
    RegionsLoader? regionsLoader,
  }) : _config = config ?? const InitConfig(),
       _regionsLoader = regionsLoader ?? DefaultRegionsLoader();
  
  @override
  RegionsLoader get regionsLoader => _regionsLoader;
  
  @override
  Future<void> initialize() async {
    if (_status == InitStatus.completed) {
      appLogger.info('Initialization already completed, skipping');
      return;
    }
    
    try {
      _status = InitStatus.inProgress;
      _progressController.add(0.0);
      
      // Load regions data
      appLogger.info('Loading regions data...');
      _progressController.add(0.3);
      await initializeRegions();
      
      // Preload images if needed
      if (_config.preloadImagePaths.isNotEmpty) {
        appLogger.info('Preloading images...');
        _progressController.add(0.6);
        await _preloadImages();
      }
      
      _progressController.add(1.0);
      _status = InitStatus.completed;
      appLogger.info('Initialization completed');
      
    } catch (e) {
      appLogger.error('Initialization failed', e);
      _status = InitStatus.failed;
      rethrow;
    }
  }
  
  Future<void> _preloadImages() async {
    // Simple implementation for preloading images
    for (final path in _config.preloadImagePaths) {
      try {
        // This would normally use precacheImage with a BuildContext
        // Since we don't have context here, just log the action
        appLogger.debug('Would preload image: $path');
        await Future.delayed(const Duration(milliseconds: 100)); // Simulate loading
      } catch (e) {
        appLogger.warning('Error preloading image $path', e);
      }
    }
  }
  
  @override
  InitStatus get status => _status;
  
  @override
  bool get isInitialized => _status == InitStatus.completed;
  
  @override
  Stream<double> get progress => _progressController.stream;
  
  /// Dispose resources
  void dispose() {
    _progressController.close();
  }
}

/// Merge loader that combines multiple loaders
class MergeInitLoader extends InitLoader {
  final List<InitLoader> _loaders;
  final InitConfig _config;
  final StreamController<double> _progressController = StreamController<double>.broadcast();
  InitStatus _status = InitStatus.notStarted;
  
  MergeInitLoader({
    required List<InitLoader> loaders,
    InitConfig? config,
  }) : _loaders = loaders,
       _config = config ?? const InitConfig();
  
  @override
  Future<void> initialize() async {
    if (_status == InitStatus.completed) {
      appLogger.info('Initialization already completed, skipping');
      return;
    }
    
    try {
      _status = InitStatus.inProgress;
      _progressController.add(0.0);
      
      // Initialize each loader sequentially
      for (int i = 0; i < _loaders.length; i++) {
        final loader = _loaders[i];
        final startProgress = i / _loaders.length;
        final endProgress = (i + 1) / _loaders.length;
        
        appLogger.info('Initializing loader ${i+1}/${_loaders.length}');
        
        // Forward progress from current loader
        final subscription = loader.progress.listen((p) {
          final mergedProgress = startProgress + (p * (endProgress - startProgress));
          _progressController.add(mergedProgress);
        });
        
        await loader.initialize();
        subscription.cancel();
      }
      
      _progressController.add(1.0);
      _status = InitStatus.completed;
      appLogger.info('All loaders initialized successfully');
      
    } catch (e) {
      appLogger.error('Initialization failed', e);
      _status = InitStatus.failed;
      rethrow;
    }
  }
  
  @override
  InitStatus get status => _status;
  
  @override
  bool get isInitialized => _status == InitStatus.completed;
  
  @override
  Stream<double> get progress => _progressController.stream;
  
  /// Dispose resources
  void dispose() {
    _progressController.close();
    // Dispose individual loaders if they have dispose methods
    for (final loader in _loaders) {
      if (loader is DefaultInitLoader) {
        loader.dispose();
      }
    }
  }
}

/// Factory for creating init loaders
class InitLoaderFactory {
  static DefaultInitLoader createDefault() {
    return DefaultInitLoader();
  }
  
  static DefaultInitLoader createWithConfig(InitConfig config) {
    return DefaultInitLoader(config: config);
  }
  
  static MergeInitLoader createMergeLoader(List<InitLoader> loaders, {InitConfig? config}) {
    return MergeInitLoader(loaders: loaders, config: config);
  }
}