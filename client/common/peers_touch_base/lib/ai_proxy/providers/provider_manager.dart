import 'dart:convert';
import 'dart:math';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_base/network/dio/peers_frame/service/ai_box_service.dart';

/// Provider类型枚举
enum ProviderType {
  openai,
  ollama,
  deepseek,
  custom, // 其他OpenAI兼容类型
}

/// Provider管理器 - 简化版本
class ProviderManager {
  final AiBoxService _aiBoxService;
  
  // 本地缓存
  final Map<String, Provider> _providers = {};
  String? _defaultProviderId;

  ProviderManager({required AiBoxService aiBoxService}) : _aiBoxService = aiBoxService;

  /// 创建新的Provider（仅本地，不保存到后台）
  /// 支持类型: openai, ollama, deepseek, custom
  Provider newProvider(ProviderType type, String url, String apiKey) {
    final id = _generateProviderId();
    final now = DateTime.now();
    
    // 基础配置
    final baseConfig = {
      'api_key': apiKey,
      'base_url': url,
      'model': _getDefaultModel(type),
    };

    return Provider(
      id: id,
      name: _getProviderName(type),
      peersUserId: '', // 将由后台填充
      sort: 0,
      enabled: true,
      checkModel: _getDefaultModel(type),
      logo: _getProviderLogo(type),
      description: _getProviderDescription(type),
      keyVaults: '', // 敏感信息，将在createProvider时处理
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

  /// 创建Provider并保存到后台
  Future<Provider> createProvider(Provider provider) async {
    try {
      // 调用后台API创建Provider
      final createdProvider = await _aiBoxService.createProvider(provider);
      
      // 缓存到本地
      _providers[createdProvider.id] = createdProvider;
      
      // 如果是第一个Provider，设为默认
      if (_providers.length == 1) {
        _defaultProviderId = createdProvider.id;
      }
      
      return createdProvider;
    } catch (e) {
      throw Exception('Failed to create provider: $e');
    }
  }

  /// 根据ID获取Provider
  Future<Provider?> getProvider(String id) async {
    // 先检查本地缓存
    if (_providers.containsKey(id)) {
      return _providers[id];
    }
    
    try {
      // 从后台获取
      final provider = await _aiBoxService.getProvider(id);
      _providers[id] = provider;
      return provider;
    } catch (e) {
      return null;
    }
  }

  /// 获取所有Provider
  Future<List<Provider>> listProviders() async {
    try {
      final providers = await _aiBoxService.listProviders();
      
      // 更新本地缓存
      _providers.clear();
      for (final provider in providers) {
        _providers[provider.id] = provider;
      }
      
      return providers;
    } catch (e) {
      // 如果获取失败，返回缓存的数据
      return _providers.values.toList();
    }
  }

  /// 更新Provider
  Future<Provider> updateProvider(Provider provider) async {
    try {
      final updatedProvider = await _aiBoxService.updateProvider(provider);
      
      // 更新本地缓存
      _providers[updatedProvider.id] = updatedProvider;
      
      return updatedProvider;
    } catch (e) {
      throw Exception('Failed to update provider: $e');
    }
  }

  /// 删除Provider
  Future<void> deleteProvider(String id) async {
    try {
      await _aiBoxService.deleteProvider(id);
      
      // 从本地缓存删除
      _providers.remove(id);
      
      // 如果删除的是默认Provider，清空默认设置
      if (_defaultProviderId == id) {
        _defaultProviderId = null;
      }
    } catch (e) {
      throw Exception('Failed to delete provider: $e');
    }
  }

  /// 设置默认Provider
  Future<void> setDefaultProvider(String id) async {
    if (!_providers.containsKey(id) && id.isNotEmpty) {
      final provider = await getProvider(id);
      if (provider == null) {
        throw Exception('Provider not found: $id');
      }
    }
    
    _defaultProviderId = id;
  }

  /// 获取默认Provider
  Provider? getDefaultProvider() {
    if (_defaultProviderId == null) {
      return null;
    }
    return _providers[_defaultProviderId];
  }

  /// 从后台初始化所有Provider
  Future<void> initProviders() async {
    try {
      final providers = await _aiBoxService.listProviders();
      
      _providers.clear();
      for (final provider in providers) {
        _providers[provider.id] = provider;
      }
      
      // 如果有Provider但没有设置默认的，设置第一个为默认
      if (_defaultProviderId == null && _providers.isNotEmpty) {
        _defaultProviderId = _providers.values.first.id;
      }
    } catch (e) {
      throw Exception('Failed to initialize providers: $e');
    }
  }

  /// 生成Provider ID
  String _generateProviderId() {
    final random = Random();
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final randomPart = random.nextInt(10000);
    return 'provider_$timestamp$randomPart';
  }

  /// 获取默认模型
  String _getDefaultModel(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'gpt-3.5-turbo';
      case ProviderType.ollama:
        return 'llama2';
      case ProviderType.deepseek:
        return 'deepseek-chat';
      case ProviderType.custom:
        return 'gpt-3.5-turbo';
    }
  }

  /// 获取Provider名称
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
    }
  }

  /// 获取Provider Logo
  String _getProviderLogo(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'https://cdn.jsdelivr.net/npm/@lobehub/icons@1.37.1/icons/openai.svg';
      case ProviderType.ollama:
        return 'https://cdn.jsdelivr.net/npm/@lobehub/icons@1.37.1/icons/ollama.svg';
      case ProviderType.deepseek:
        return 'https://cdn.jsdelivr.net/npm/@lobehub/icons@1.37.1/icons/deepseek.svg';
      case ProviderType.custom:
        return 'https://cdn.jsdelivr.net/npm/@lobehub/icons@1.37.1/icons/openai.svg';
    }
  }

  /// 获取Provider描述
  String _getProviderDescription(ProviderType type) {
    switch (type) {
      case ProviderType.openai:
        return 'OpenAI GPT models';
      case ProviderType.ollama:
        return 'Local Ollama models';
      case ProviderType.deepseek:
        return 'DeepSeek AI models';
      case ProviderType.custom:
        return 'Custom OpenAI-compatible provider';
    }
  }
}