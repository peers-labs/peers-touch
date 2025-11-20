import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart';

import '../provider/rich_provider.dart';

class AiProxyAdapter {
  final AiBoxService _aiBoxService;
  List<RichProvider> _providers = [];

  AiProxyAdapter(this._aiBoxService);

  Future<void> initialize() async {
    final rawProviders = await _aiBoxService.listProviders();
    _providers = rawProviders.map((p) => RichProvider(p)).toList();
  }

  List<RichProvider> get allProviders => _providers;

  RichProvider? getProviderForModel(String modelName) {
    for (final provider in _providers) {
      if (provider.models.any((model) => model.name == modelName)) {
        return provider;
      }
    }
    return null;
  }

  RichProvider? getProvider(String providerId) {
    for (final provider in _providers) {
      if (provider.id == providerId) {
        return provider;
      }
    }
    return null;
  }
}