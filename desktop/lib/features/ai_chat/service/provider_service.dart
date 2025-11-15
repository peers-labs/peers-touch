import 'package:get/get.dart';
import 'package:peers_touch_desktop/core/network/api_client.dart';
import 'package:peers_touch_desktop/features/ai_chat/model/provider.dart';
import 'package:peers_touch_desktop/features/ai_chat/service/ai_service_factory.dart';

/// AI服务提供商管理服务
class ProviderService {
  static const String _providersKey = 'ai_providers';
  static const String _currentProviderKey = 'current_ai_provider';
  
  final StorageService _localStorageService = Get.find<StorageService>();
  final SecureStorageService _secureStorageService = Get.find<SecureStorageService>();
  final ApiClient _apiClient = Get.find<ApiClient>();
  
  /// 获取所有提供商
  Future<List<Provider>> getProviders() async {
    try {
      final providersData = _localStorageService.get<List>(_providersKey) ?? [];
      return providersData.map((data) => Provider.fromJson(data)).toList();
    } catch (e) {
      return [];
    }
  }
  
  /// 获取当前提供商
  Future<Provider?> getCurrentProvider() async {
    try {
      final currentId = _localStorageService.get<String>(_currentProviderKey);
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
  Future<void> saveProvider(Provider provider) async {
    try {
      final providers = await getProviders();
      final index = providers.indexWhere((p) => p.id == provider.id && p.peersUserId == provider.peersUserId);
      
      if (index >= 0) {
        providers[index] = provider;
      } else {
        providers.add(provider);
      }
      
      // 保存到本地存储
      final providersJson = providers.map((p) => p.toJson()).toList();
      _localStorageService.set(_providersKey, providersJson);
      
      // 如果是当前提供商，更新当前提供商
      final currentId = _localStorageService.get<String>(_currentProviderKey);
      if (currentId == provider.id) {
        _localStorageService.set(_currentProviderKey, provider.id);
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
      
      final providersJson = providers.map((p) => p.toJson()).toList();
      _localStorageService.set(_providersKey, providersJson);
      
      // 如果删除的是当前提供商，清除当前提供商
      final currentId = _localStorageService.get<String>(_currentProviderKey);
      if (currentId == providerId) {
        _localStorageService.remove(_currentProviderKey);
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
      
      _localStorageService.set(_currentProviderKey, providerId);
      
      // 更新访问时间
      final updatedProvider = provider.copyWith(
        accessedAt: DateTime.now().toUtc(),
      );
      await saveProvider(updatedProvider);
    } catch (e) {
      throw Exception('Failed to set current provider: $e');
    }
  }
  
  /// 测试提供商连接
  Future<bool> testProviderConnection(Provider provider) async {
    try {
      // 构建测试请求
      final testPayload = {
        'model': provider.checkModel ?? 'gpt-3.5-turbo',
        'messages': [
          {'role': 'user', 'content': 'Hello, this is a connection test.'}
        ],
        'max_tokens': 10,
      };
      
      // 根据提供商类型调用不同的API
      final response = await _apiClient.post(
        '${provider.baseUrl}/chat/completions',
        data: testPayload,
        options: null, // 使用默认选项
      );
      
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }
  
  /// 获取提供商的模型列表（统一入口：AIServiceFactory.fromProvider）
  Future<List<String>> fetchProviderModels(Provider provider) async {
    try {
      final service = AIServiceFactory.fromProvider(provider);
      final models = await service.fetchModels();
      return models;
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
      settings: {
        'baseUrl': _getDefaultBaseUrl(sourceType),
      },
      config: {
        'temperature': 0.7,
        'maxTokens': 2048,
        'topP': 1.0,
        'frequencyPenalty': 0.0,
        'presencePenalty': 0.0,
      },
      accessedAt: now,
      createdAt: now,
      updatedAt: now,
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
  
}