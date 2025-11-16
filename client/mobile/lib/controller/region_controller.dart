import 'package:get/get.dart';
import 'package:peers_touch_mobile/common/region/region_manager.dart';
import 'package:peers_touch_mobile/common/init/init_loader_regions.dart';

/// Region controller for managing region data in the app
/// Uses GetX for reactive state management
class RegionController extends GetxController {
  final RegionManager _regionManager = RegionManager();
  
  // Reactive state
  final RxList<RegionData> regions = <RegionData>[].obs;
  final RxBool isReady = false.obs;
  final RxBool isLoading = false.obs;
  
  @override
  void onInit() {
    super.onInit();
    initialize();
  }

  /// Initialize region data
  Future<void> initialize() async {
    if (isReady.value) return;
    
    isLoading.value = true;
    try {
      await _regionManager.initialize();
      regions.value = _regionManager.getAllRegions();
      isReady.value = true;
    } catch (e) {
      regions.value = _regionManager.getAllRegions(); // Use fallback data
      isReady.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /// Get all regions
  List<RegionData> getAllRegions() => _regionManager.getAllRegions();

  /// Get region by country code
  RegionData? getRegionByCode(String code) => _regionManager.getRegionByCode(code);

  /// Search regions by name or code
  List<RegionData> searchRegions(String query) => _regionManager.searchRegions(query);

  /// Get regions by continent
  List<RegionData> getRegionsByContinent(String continent) => 
      _regionManager.getRegionsByContinent(continent);

  /// Refresh regions data
  Future<void> refreshRegions() async {
    isLoading.value = true;
    try {
      await _regionManager.refreshRegions();
      regions.value = _regionManager.getAllRegions();
    } finally {
      isLoading.value = false;
    }
  }

  /// Get region display name with flag emoji
  String getDisplayName(RegionData region) {
    final flagEmoji = getFlagEmoji(region.code);
    return '$flagEmoji ${region.name}';
  }

  /// Convert country code to flag emoji
  String getFlagEmoji(String countryCode) {
    if (countryCode.length != 2) return '🏳️';
    
    final code = countryCode.toUpperCase();
    final first = code.codeUnitAt(0) - 0x41 + 0x1F1E6;
    final second = code.codeUnitAt(1) - 0x41 + 0x1F1E6;
    
    return String.fromCharCode(first) + String.fromCharCode(second);
  }

  /// Get popular regions (top 20 by usage)
  List<RegionData> getPopularRegions() {
    final allRegions = getAllRegions();
    if (allRegions.isEmpty) return [];
    
    // Return first 20 regions or all if less than 20
    return allRegions.take(20).toList();
  }

  /// Get regions grouped by continent
  Map<String, List<RegionData>> getRegionsByContinents() {
    final allRegions = getAllRegions();
    final Map<String, List<RegionData>> grouped = {};
    
    for (final region in allRegions) {
      final continent = region.region ?? 'Unknown';
      grouped.putIfAbsent(continent, () => []).add(region);
    }
    
    for (final continent in grouped.keys) {
      grouped[continent]!.sort((a, b) => a.name.compareTo(b.name));
    }
    
    return grouped;
  }

  /// Filter regions for autocomplete
  List<RegionData> autocompleteRegions(String query, {int limit = 5}) {
    if (query.isEmpty) return [];
    
    final results = searchRegions(query);
    return results.take(limit).toList();
  }

  /// Validate country code
  bool isValidCountryCode(String code) {
    try {
      return getRegionByCode(code) != null;
    } catch (e) {
      return false;
    }
  }

  /// Get region suggestions based on partial input
  List<RegionData> getSuggestions(String partial) {
    if (partial.length < 2) return [];
    
    return searchRegions(partial)
        .where((region) => 
            region.name.toLowerCase().startsWith(partial.toLowerCase()) ||
            region.code.toLowerCase().startsWith(partial.toLowerCase()))
        .take(10)
        .toList();
  }


}