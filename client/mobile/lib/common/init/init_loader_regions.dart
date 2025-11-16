import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:peers_touch_mobile/common/logger/logger.dart';

/// Region data model for country information
class RegionData {
  final String name;
  final String code;
  final String? flagUrl;
  final String? capital;
  final String? region;
  
  const RegionData({
    required this.name,
    required this.code,
    this.flagUrl,
    this.capital,
    this.region,
  });
  
  factory RegionData.fromJson(Map<String, dynamic> json) {
    return RegionData(
      name: json['name']['common'] ?? '',
      code: json['cca2'] ?? '',
      flagUrl: json['flags']?['png'],
      capital: (json['capital'] as List?)?.isNotEmpty == true ? json['capital'][0] : null,
      region: json['region'],
    );
  }
}

/// Interface for loading region data
abstract class RegionsLoader {
  /// Load regions from API
  Future<List<RegionData>> loadRegions();
  
  /// Check if regions are already loaded
  bool get areRegionsLoaded;
  
  /// Get loaded regions
  List<RegionData> get loadedRegions;
  
  /// Refresh regions data
  Future<void> refreshRegions();
}

/// Default implementation of RegionsLoader
class DefaultRegionsLoader implements RegionsLoader {
  final String _apiUrl = 'https://restcountries.com/v3.1/all?fields=name,cca2,flags,capital,region';
  List<RegionData> _regions = [];
  bool _loaded = false;
  
  @override
  Future<List<RegionData>> loadRegions() async {
    if (_loaded) {
      appLogger.info('Regions already loaded, skipping');
      return _regions;
    }
    
    try {
      final response = await http.get(Uri.parse(_apiUrl));
      
      if (response.statusCode == 200) {
        final List<dynamic> data = jsonDecode(response.body);
        _regions = data.map((json) => RegionData.fromJson(json)).toList();
        _regions.sort((a, b) => a.name.compareTo(b.name));
        _loaded = true;
        return _regions;
      } else {
        throw Exception('Failed to load regions: ${response.statusCode}');
      }
    } catch (e) {
      appLogger.warning('Error loading regions, using fallback data', e);
      // Fallback to some basic regions if API fails
      _regions = _getFallbackRegions();
      _loaded = true;
      return _regions;
    }
  }
  
  @override
  bool get areRegionsLoaded => _loaded;
  
  @override
  List<RegionData> get loadedRegions => _regions;
  
  @override
  Future<void> refreshRegions() async {
    _loaded = false;
    await loadRegions();
  }
  
  /// Fallback regions in case API fails
  List<RegionData> _getFallbackRegions() {
    return [
      const RegionData(name: 'United States', code: 'US'),
      const RegionData(name: 'United Kingdom', code: 'GB'),
      const RegionData(name: 'Canada', code: 'CA'),
      const RegionData(name: 'Australia', code: 'AU'),
      const RegionData(name: 'Germany', code: 'DE'),
      const RegionData(name: 'France', code: 'FR'),
      const RegionData(name: 'Japan', code: 'JP'),
      const RegionData(name: 'China', code: 'CN'),
      const RegionData(name: 'India', code: 'IN'),
      const RegionData(name: 'Brazil', code: 'BR'),
    ];
  }
}

/// Mixin for adding region loading capabilities
mixin RegionsLoaderMixin {
  RegionsLoader get regionsLoader;
  
  Future<void> initializeRegions() async {
    if (regionsLoader.areRegionsLoaded) {
      appLogger.info('Regions already loaded, skipping initialization');
      return;
    }
    
    await regionsLoader.loadRegions();
  }
  
  bool get areRegionsLoaded => regionsLoader.areRegionsLoaded;
  List<RegionData> get loadedRegions => regionsLoader.loadedRegions;
}