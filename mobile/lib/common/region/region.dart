/// Region library - Central exports for region functionality
/// 
/// This library provides comprehensive region data access and UI components
/// for working with country/region data loaded from the REST Countries API.

library region;

// Core functionality
export 'region_manager.dart';
export 'region_provider.dart';

// Widgets
export 'region_widgets.dart';

// Re-export region data model for convenience
export 'package:peers_touch_mobile/common/init/init_loader_regions.dart' show RegionData;