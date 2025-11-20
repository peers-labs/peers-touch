import 'dart:convert';

import 'package:get/get.dart';
import 'package:peers_touch_base/ai_proxy/provider/provider_manager.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';

/// AI服务提供商管理服务
class ProviderService {
  static const String _currentProviderKey = 'current_ai_provider';

  final LocalStorage _localStorage = Get.find<LocalStorage>();
  final ApiClient _apiClient = Get.find<ApiClient>();
  final ProviderManager _providerManager = Get.find<ProviderManager>();

  /// 获取所有提供商
  Future<List<Provider>> getProviders() async {
    try {
      return await _providerManager.listProviders();
    } catch (e) {
      return [];
    }
  }

  /// 保存提供商（新）
  Future<void> saveProviderNew(Provider provider) async {
    try {
      await _providerManager.createProvider(provider);
    } catch (e) {
      throw Exception('Failed to save provider new: $e');
    }
  }

  /// 获取当前提供商
  Future<Provider?> getCurrentProvider() async {
    try {
      final currentId = _localStorage.get<String>(_currentProviderKey);
      if (currentId == null) {
        // 如果没有设置当前提供商，尝试获取默认提供商
        final defaultProvider = _providerManager.getDefaultProvider();
        if (defaultProvider != null) {
          return defaultProvider;
        }

        // 如果也没有默认提供商，返回第一个启用的提供商
        final providers = await getProviders();
        return providers.firstWhere(
          (p) => p.enabled,
          orElse: () => providers.isNotEmpty
              ? providers.first
              : throw Exception('No provider found'),
        );
      }

      // 根据ID获取当前提供商
      return await _providerManager.getProvider(currentId);
    } catch (e) {
      return null;
    }
  }

  /// 保存提供商
  Future<void> saveProvider(Provider provider) async {
    try {
      // 检查是否已存在
      final existingProvider = await _providerManager.getProvider(provider.id);
      if (existingProvider != null) {
        // 更新现有提供商
        await _providerManager.updateProvider(provider);
      } else {
        // 创建新提供商
        await _providerManager.createProvider(provider);
      }

      // 如果是当前提供商，更新当前提供商
      final currentId = _localStorage.get<String>(_currentProviderKey);
      if (currentId == provider.id) {
        _localStorage.set(_currentProviderKey, provider.id);
      }
    } catch (e) {
      throw Exception('Failed to save provider: $e');
    }
  }

  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    try {
      await _providerManager.deleteProvider(providerId);

      // 如果删除的是当前提供商，清除当前提供商
      final currentId = _localStorage.get<String>(_currentProviderKey);
      if (currentId == providerId) {
        _localStorage.remove(_currentProviderKey);
      }
    } catch (e) {
      throw Exception('Failed to delete provider: $e');
    }
  }

  /// 设置当前提供商
  Future<void> setCurrentProvider(String providerId) async {
    try {
      final provider = await _providerManager.getProvider(providerId);
      if (provider == null) {
        throw Exception('Provider not found');
      }

      _localStorage.set(_currentProviderKey, providerId);

      // 更新访问时间
      final updatedProvider = provider.rebuild(
        (b) => b..accessedAt = Timestamp.fromDateTime(DateTime.now().toUtc()),
      );
      await saveProvider(updatedProvider);
    } catch (e) {
      throw Exception('Failed to set current provider: $e');
    }
  }

  /// 测试提供商连接
  Future<bool> testProviderConnection(Provider provider) async {
    try {
      // 解析settingsJson获取baseUrl
      final settings = provider.settingsJson.isNotEmpty
          ? jsonDecode(provider.settingsJson) as Map<String, dynamic>
          : {};

      final baseUrl =
          settings['baseUrl'] as String? ??
          _getDefaultBaseUrl(provider.sourceType);

      // 构建测试请求
      final testPayload = {
        'model': provider.checkModel.isNotEmpty
            ? provider.checkModel
            : 'gpt-3.5-turbo',
        'messages': [
          {'role': 'user', 'content': 'Hello, this is a connection test.'},
        ],
        'max_tokens': 10,
      };

      // 根据提供商类型调用不同的API
      final response = await _apiClient.post(
        '$baseUrl/chat/completions',
        data: testPayload,
        options: null, // 使用默认选项
      );

      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  /// 获取提供商的模型列表
  Future<List<String>> fetchProviderModels(Provider provider) async {
    try {
      // 解析settingsJson获取baseUrl
      final settings = provider.settingsJson.isNotEmpty
          ? jsonDecode(provider.settingsJson) as Map<String, dynamic>
          : {};

      final baseUrl =
          settings['baseUrl'] as String? ??
          _getDefaultBaseUrl(provider.sourceType);

      // 根据提供商类型调用不同的API
      final response = await _apiClient.get(
        '$baseUrl/models',
        options: null, // 使用默认选项
      );

      if (response.statusCode == 200) {
        final data = response.data;
        if (data is Map && data['data'] is List) {
          return (data['data'] as List)
              .map((model) => model['id']?.toString() ?? '')
              .where((id) => id.isNotEmpty)
              .toList();
        }
      }

      return [];
    } catch (e) {
      return [];
    }
  }

  /// 创建默认提供商
  Provider createDefaultProvider({
    required String id,
    required String name,
    required String sourceType,
    required String peersUserId,
  }) {
    final now = DateTime.now().toUtc();

    return Provider(
      id: id,
      name: name,
      peersUserId: peersUserId,
      sort: 0,
      enabled: true,
      sourceType: sourceType,
      checkModel: _getDefaultModels(sourceType).first,
      settingsJson: jsonEncode({
        'baseUrl': _getDefaultBaseUrl(sourceType),
        'models': _getDefaultModels(sourceType),
      }),
      configJson: jsonEncode({
        'temperature': 0.7,
        'maxTokens': 2048,
        'topP': 1.0,
        'frequencyPenalty': 0.0,
        'presencePenalty': 0.0,
      }),
      accessedAt: Timestamp.fromDateTime(now),
      createdAt: Timestamp.fromDateTime(now),
      updatedAt: Timestamp.fromDateTime(now),
    );
  }

  /// 获取默认基础URL
  String _getDefaultBaseUrl(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'ollama':
        return 'http://localhost:11434';
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'google':
        return 'https://generativelanguage.googleapis.com';
      default:
        return 'https://api.openai.com/v1';
    }
  }

  /// 获取默认模型列表
  List<String> _getDefaultModels(String sourceType) {
    switch (sourceType.toLowerCase()) {
      case 'openai':
        return ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo'];
      case 'ollama':
        return ['llama2', 'mistral', 'codellama'];
      case 'anthropic':
        return ['claude-3-sonnet', 'claude-3-opus'];
      case 'google':
        return ['gemini-pro', 'gemini-pro-vision'];
      default:
        return ['gpt-3.5-turbo'];
    }
  }
}
