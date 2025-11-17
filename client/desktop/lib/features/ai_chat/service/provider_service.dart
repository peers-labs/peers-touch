import 'dart:convert';
import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/core/storage/local_storage.dart';
import 'package:peers_touch_base/model/domain/ai_box/ai_box.pb.dart';
import 'package:peers_touch_base/model/google/protobuf/timestamp.pb.dart' as pb_timestamp;

/// AI服务提供商管理服务
class ProviderService {
  static const String _providersKey = 'ai_providers';
  static const String _currentProviderKey = 'current_ai_provider';
  
  final LocalStorage _localStorage = Get.find<LocalStorage>();
  final ApiClient _apiClient = Get.find<ApiClient>();
  
  /// 获取所有提供商
  Future<List<AiProvider>> getProviders() async {
    try {
      final providersData = _localStorage.get<List>(_providersKey) ?? [];
      return providersData.map((data) {
        if (data is String) {
          return AiProvider.fromJson(data);
        } else if (data is Map) {
          // Handle legacy format - convert Map to JSON string
          return AiProvider.fromJson(data.toString());
        }
        throw Exception('Invalid provider data format');
      }).toList();
    } catch (e) {
      return [];
    }
  }
  
  /// 获取当前提供商
  Future<AiProvider?> getCurrentProvider() async {
    try {
      final currentId = _localStorage.get<String>(_currentProviderKey);
      if (currentId == null) return null;
      
      final providers = await getProviders();
      return providers.firstWhere(
        (p) => p.id == currentId && p.enabled,
        orElse: () => providers.firstWhere(
          (p) => p.enabled,
          orElse: () => throw Exception('No enabled provider found'),
        ),
      );
    } catch (e) {
      return null;
    }
  }
  
  /// 保存提供商
  Future<void> saveProvider(AiProvider provider) async {
    try {
      final providers = await getProviders();
      final index = providers.indexWhere((p) => p.id == provider.id && p.peersUserId == provider.peersUserId);
      
      if (index >= 0) {
        providers[index] = provider;
      } else {
        providers.add(provider);
      }
      
      // 保存到本地存储
      final providersJson = providers.map((p) => p.writeToJson()).toList();
      _localStorage.set(_providersKey, providersJson);
      
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
  Future<void> deleteProvider(String providerId, String userId) async {
    try {
      final providers = await getProviders();
      providers.removeWhere((p) => p.id == providerId && p.peersUserId == userId);
      
      final providersJson = providers.map((p) => p.writeToJson()).toList();
      _localStorage.set(_providersKey, providersJson);
      
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
      final providers = await getProviders();
      final provider = providers.firstWhere(
        (p) => p.id == providerId,
        orElse: () => throw Exception('Provider not found'),
      );
      
      _localStorage.set(_currentProviderKey, providerId);
      
      // 更新访问时间
      final updatedProvider = AiProvider()
        ..id = provider.id
        ..name = provider.name
        ..peersUserId = provider.peersUserId
        ..sort = provider.sort
        ..enabled = provider.enabled
        ..checkModel = provider.checkModel
        ..logo = provider.logo
        ..description = provider.description
        ..keyVaults = provider.keyVaults
        ..sourceType = provider.sourceType
        ..settings = provider.settings
        ..config = provider.config
        ..accessedAt = pb_timestamp.Timestamp.fromDateTime(DateTime.now().toUtc())
        ..createdAt = provider.createdAt
        ..updatedAt = provider.updatedAt;
      await saveProvider(updatedProvider);
    } catch (e) {
      throw Exception('Failed to set current provider: $e');
    }
  }
  
  /// 测试提供商连接
  Future<bool> testProviderConnection(AiProvider provider) async {
    try {
      // 从settings中获取baseUrl
      final settings = _parseSettings(provider.settings);
      final baseUrl = settings['baseUrl'] ?? _getDefaultBaseUrl(provider.sourceType);
      
      // 构建测试请求
      final testPayload = {
        'model': provider.checkModel.isNotEmpty ? provider.checkModel : 'gpt-3.5-turbo',
        'messages': [
          {'role': 'user', 'content': 'Hello, this is a connection test.'}
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
  Future<List<String>> fetchProviderModels(AiProvider provider) async {
    try {
      // 从settings中获取baseUrl
      final settings = _parseSettings(provider.settings);
      final baseUrl = settings['baseUrl'] ?? _getDefaultBaseUrl(provider.sourceType);
      
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
  AiProvider createDefaultProvider({
    required String id,
    required String name,
    required String sourceType,
    required String peersUserId,
  }) {
    final now = DateTime.now().toUtc();
    
    return AiProvider()
      ..id = id
      ..name = name
      ..peersUserId = peersUserId
      ..sort = 0
      ..enabled = true
      ..sourceType = sourceType
      ..settings = '{"baseUrl": "${_getDefaultBaseUrl(sourceType)}", "models": ${_getDefaultModels(sourceType).map((m) => '"$m"').join(', ')}}'
      ..config = '{"temperature": 0.7, "maxTokens": 2048, "topP": 1.0, "frequencyPenalty": 0.0, "presencePenalty": 0.0}'
      ..accessedAt = pb_timestamp.Timestamp.fromDateTime(now)
      ..createdAt = pb_timestamp.Timestamp.fromDateTime(now)
      ..updatedAt = pb_timestamp.Timestamp.fromDateTime(now);
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

  /// 解析设置字符串
  Map<String, dynamic> _parseSettings(String settings) {
    try {
      if (settings.isEmpty) return {};
      return jsonDecode(settings) as Map<String, dynamic>;
    } catch (e) {
      return {};
    }
  }
}