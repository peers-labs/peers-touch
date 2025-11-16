import 'package:peers_touch_mobile/common/init/init_loader_regions.dart';
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Central manager for region data access and operations
class RegionManager {
  static final RegionManager _instance = RegionManager._internal();
  factory RegionManager() => _instance;
  RegionManager._internal();

  final RegionsLoader _regionsLoader = DefaultRegionsLoader();
  bool _initialized = false;

  /// Initialize region data
  Future<void> initialize() async {
    if (_initialized) {
      appLogger.info('RegionManager already initialized');
      return;
    }

    try {
      await _regionsLoader.loadRegions();
      _initialized = true;
      appLogger.info('RegionManager initialized successfully');
    } catch (e) {
      appLogger.error('Failed to initialize RegionManager', e);
      rethrow;
    }
  }

  /// Get all regions
  List<RegionData> getAllRegions() {
    _ensureInitialized();
    return _regionsLoader.loadedRegions;
  }

  /// Get region by country code
  RegionData? getRegionByCode(String code) {
    _ensureInitialized();
    return _regionsLoader.loadedRegions.firstWhere(
      (region) => region.code.toLowerCase() == code.toLowerCase(),
      orElse: () => throw RegionNotFoundException('Region not found: $code'),
    );
  }

  /// Search regions by name
  List<RegionData> searchRegions(String query) {
    _ensureInitialized();
    if (query.isEmpty) return _regionsLoader.loadedRegions;
    
    return _regionsLoader.loadedRegions.where((region) =>
      region.name.toLowerCase().contains(query.toLowerCase()) ||
      region.code.toLowerCase().contains(query.toLowerCase())
    ).toList();
  }

  /// Get regions by continent/region
  List<RegionData> getRegionsByContinent(String continent) {
    _ensureInitialized();
    return _regionsLoader.loadedRegions.where((region) =>
      region.region?.toLowerCase() == continent.toLowerCase()
    ).toList();
  }

  /// Check if regions are loaded
  bool get isReady => _regionsLoader.areRegionsLoaded;

  /// Refresh regions data
  Future<void> refreshRegions() async {
    await _regionsLoader.refreshRegions();
    appLogger.info('Regions data refreshed');
  }

  void _ensureInitialized() {
    if (!_initialized) {
      throw RegionNotInitializedException(
        'RegionManager not initialized. Call initialize() first.'
      );
    }
  }
}

/// Custom exceptions
class RegionException implements Exception {
  final String message;
  RegionException(this.message);
  
  @override
  String toString() => 'RegionException: $message';
}

class RegionNotFoundException extends RegionException {
  RegionNotFoundException(String code) : super('Region not found: $code');
}

class RegionNotInitializedException extends RegionException {
  RegionNotInitializedException(String message) : super(message);
}