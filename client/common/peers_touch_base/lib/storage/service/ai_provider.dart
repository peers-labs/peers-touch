import 'package:peers_touch_base/peers_touch_base.dart';
import 'package:peers_touch_base/model/domain/ai_box/ai_box.pb.dart';
import 'dart:convert';

/// AI提供商存储服务接口
abstract class AIProviderStorageService {
  /// 获取所有提供商
  Future<List<AiProvider>> getProviders();
  
  /// 保存提供商
  Future<void> saveProvider(AiProvider provider);
  
  /// 删除提供商
  Future<void> deleteProvider(String providerId, String userId);
  
  /// 获取当前提供商
  Future<AiProvider?> getCurrentProvider();
  
  /// 设置当前提供商
  Future<void> setCurrentProvider(String providerId);
  
  /// 测试提供商连接
  Future<bool> testProviderConnection(AiProvider provider);
  
  /// 获取提供商模型列表
  Future<List<String>> fetchProviderModels(AiProvider provider);
}

/// AI提供商存储服务实现
class AIProviderStorageServiceImpl implements AIProviderStorageService {
  final LocalStorage _localStorage;
  
  AIProviderStorageServiceImpl({required LocalStorage localStorage}) 
      : _localStorage = localStorage;
  
  @override
  Future<List<AiProvider>> getProviders() async {
    final providersData = await _localStorage.get<List<dynamic>>('ai_providers');
    if (providersData == null) return [];
    
    return providersData
        .whereType<Map<String, dynamic>>()
        .map((json) => AiProvider.fromJson(jsonEncode(json)))
        .toList();
  }
  
  @override
  Future<void> saveProvider(AiProvider provider) async {
    final providers = await getProviders();
    final existingIndex = providers.indexWhere((p) => p.id == provider.id);
    
    if (existingIndex >= 0) {
      providers[existingIndex] = provider;
    } else {
      providers.add(provider);
    }
    
    await _localStorage.set('ai_providers', 
        providers.map((p) => p.writeToJson()).toList());
  }
  
  @override
  Future<void> deleteProvider(String providerId, String userId) async {
    final providers = await getProviders();
    providers.removeWhere((p) => p.id == providerId);
    await _localStorage.set('ai_providers', 
        providers.map((p) => p.toJson()).toList());
  }
  
  @override
  Future<AiProvider?> getCurrentProvider() async {
    final currentProviderId = await _localStorage.get<String>('current_ai_provider');
    if (currentProviderId == null) return null;
    
    final providers = await getProviders();
    try {
      return providers.firstWhere(
        (p) => p.id == currentProviderId,
      );
    } catch (e) {
      return null;
    }
  }
  
  @override
  Future<void> setCurrentProvider(String providerId) async {
    await _localStorage.set('current_ai_provider', providerId);
  }
  
  @override
  Future<bool> testProviderConnection(AiProvider provider) async {
    // 这里应该调用实际的AI服务进行连接测试
    // 暂时返回true作为占位符
    return true;
  }
  
  @override
  Future<List<String>> fetchProviderModels(AiProvider provider) async {
    // 这里应该调用实际的AI服务获取模型列表
    // 暂时返回默认模型列表作为占位符
    switch (provider.sourceType.toLowerCase()) {
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