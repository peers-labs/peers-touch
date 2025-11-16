import 'package:flutter/material.dart';
import 'package:peers_touch_mobile/common/region/region_manager.dart';
import 'package:peers_touch_mobile/common/init/init_loader_regions.dart';

/// Region provider widget for easy access to region data
class RegionProvider extends InheritedWidget {
  final RegionManager regionManager;

  const RegionProvider({
    Key? key,
    required this.regionManager,
    required Widget child,
  }) : super(key: key, child: child);

  static RegionProvider? of(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<RegionProvider>();
  }

  static RegionManager manager(BuildContext context) {
    return of(context)!.regionManager;
  }

  @override
  bool updateShouldNotify(RegionProvider oldWidget) {
    return regionManager != oldWidget.regionManager;
  }
}

/// Region data service for controllers
class RegionService {
  final RegionManager _manager = RegionManager();

  Future<void> initialize() async {
    await _manager.initialize();
  }

  List<RegionData> getAllRegions() => _manager.getAllRegions();
  
  RegionData? getRegionByCode(String code) => _manager.getRegionByCode(code);
  
  List<RegionData> searchRegions(String query) => _manager.searchRegions(query);
  
  List<RegionData> getRegionsByContinent(String continent) => 
      _manager.getRegionsByContinent(continent);
  
  bool get isReady => _manager.isReady;
  
  Future<void> refreshRegions() => _manager.refreshRegions();
}

/// Future builder for region data
class RegionFutureBuilder extends StatelessWidget {
  final Widget Function(List<RegionData>) builder;
  final Widget? loadingWidget;
  final Widget? errorWidget;

  const RegionFutureBuilder({
    Key? key,
    required this.builder,
    this.loadingWidget,
    this.errorWidget,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: RegionManager().initialize(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return loadingWidget ?? const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return errorWidget ?? Center(child: Text('Error loading regions: ${snapshot.error}'));
        }

        final regions = RegionManager().getAllRegions();
        return builder(regions);
      },
    );
  }
}