import 'dart:convert';
import 'dart:math';

import 'package:peers_touch_base/ai_proxy/provider/provider_manager_interface.dart';
import 'package:peers_touch_base/ai_proxy/service/ai_box_local_storage_service.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';

// 移除冲突的导入
// import 'provider_manager.dart'; // 引入ProviderType

/// Provider本地管理器 - 所有操作均在本地完成
class LocalProviderManager implements IProviderManager {

  LocalProviderManager({AiBoxLocalStorageService? localStorage})
    : _localStorage = localStorage ?? AiBoxLocalStorageService();
  final AiBoxLocalStorageService _localStorage;

  @override
  Provider newProvider(ProviderType type, String url, String apiKey) {
    final id = _generateProviderId();
    final now = DateTime.now();
    final baseConfig = {
      'api_key': apiKey,
      'base_url': url,
      'model': _getDefaultModel(type),
    };

    return Provider(
      id: id,
      name: _getProviderName(type),
      peersUserId: 'local',
      // 本地模式下标记为local
      sort: 0,
      enabled: true,
      checkModel: _getDefaultModel(type),
      logo: _getProviderLogo(type),
      description: _getProviderDescription(type),
      keyVaults: '',
      sourceType: type.name,
      settingsJson: jsonEncode({
        'provider_type': type.name,
        'api_version': 'v1',
      }),
      configJson: jsonEncode(baseConfig),
      accessedAt: Timestamp.fromDateTime(now.toUtc()),
      createdAt: Timestamp.fromDateTime(now.toUtc()),
      updatedAt: Timestamp.fromDateTime(now.toUtc()),
    );
  }

  @override
  Future<Provider> createProvider(Provider provider) async {
    await _localStorage.saveProvider(provider);
    final providers = await _localStorage.getAllProviders();
    if (providers.length == 1) {
      await _localStorage.setDefaultProviderId(provider.id);
    }
    return provider;
  }

  @override
  Future<Provider?> getProvider(String id) async {
    final providerMap = await _localStorage.getProvider(id);
    return providerMap != null ? _mapToProvider(providerMap) : null;
  }

  @override
  Future<List<Provider>> listProviders() async {
    final providerMaps = await _localStorage.getAllProviders();
    return providerMaps.map(_mapToProvider).toList();
  }

  @override
  Future<Provider> updateProvider(Provider provider) async {
    await _localStorage.saveProvider(provider);
    return provider;
  }

  @override
  Future<void> deleteProvider(String id) async {
    await _localStorage.deleteProvider(id);
  }

  @override
  Future<Provider?> getDefaultProvider() async {
    final providerId = await _localStorage.getDefaultProviderId();
    if (providerId == null) return null;
    return await getProvider(providerId);
  }

  @override
  Future<void> setDefaultProvider(String id) async {
    await _localStorage.setDefaultProviderId(id);
  }

  @override
  Future<Provider?> getCurrentProvider() async {
    final providerId = await _localStorage.getCurrentProviderId();
    if (providerId == null) return null;
    return await getProvider(providerId);
  }

  @override
  Future<void> setCurrentProvider(String id) async {
    await _localStorage.setCurrentProviderId(id);
  }

  @override
  Future<Provider?> getCurrentProviderForSession(String sessionId) async {
    final providerId = await _localStorage.getSessionCurrentProviderId(
      sessionId,
    );
    if (providerId == null || providerId.isEmpty) {
      return await getDefaultProvider();
    }
    return await getProvider(providerId);
  }

  @override
  Future<void> setCurrentProviderForSession(String sessionId, String id) async {
    await _localStorage.setSessionCurrentProviderId(sessionId, id);
  }

  // --- 私有辅助方法 (从ProviderManager复制) ---

  String _generateProviderId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final random = Random();
    return String.fromCharCodes(
      Iterable.generate(
        12,
        (_) => chars.codeUnitAt(random.nextInt(chars.length)),
      ),
    );
  }

  String _getDefaultModel(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'gpt-4o';
      case ProviderType.ollama:
        return 'llama3';
      case ProviderType.deepseek:
        return 'deepseek-chat';
      case ProviderType.custom:
        return 'custom-model';
      default:
        return 'custom-model';
    }
  }

  String _getProviderName(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'OpenAI';
      case ProviderType.ollama:
        return 'Ollama';
      case ProviderType.deepseek:
        return 'DeepSeek';
      case ProviderType.custom:
        return 'Custom Provider';
      default:
        return 'Custom Provider';
    }
  }

  String _getProviderLogo(ProviderType type) {
    // 在实际应用中，这里应该是logo的URL或asset路径
    return 'assets/logo_${type.name}.png';
  }

  String _getProviderDescription(ProviderType type) {
    return 'A ${type.name} provider configuration.';
  }

  Provider _mapToProvider(Map<String, dynamic> map) {
    return Provider.create()..mergeFromProto3Json(map);
  }
}
