import 'package:flutter/foundation.dart';
import 'package:peers_touch_base/storage/service/ai_provider.dart';
import 'package:peers_touch_base/storage/secure_storage.dart';
import 'package:peers_touch_base/model/domain/ai_box/provider.pb.dart';
import 'package:fixnum/fixnum.dart' as $fixnum;
import 'dart:convert';
import 'package:peers_touch_base/model/domain/ai_box/ai_box.pb.dart' as $0;

/// AI服务提供商代理 - 包含所有非视图业务逻辑
class AIProviderProxy {
  final AIProviderStorageService _providerService;
  final SecureStorageService _secureStorage;
  
  // 状态管理
  final ValueNotifier<List<Provider>> providers = ValueNotifier([]);
  final ValueNotifier<Provider?> currentProvider = ValueNotifier(null);
  final ValueNotifier<bool> isLoading = ValueNotifier(false);
  final ValueNotifier<String> selectedProviderId = ValueNotifier('');
  
  AIProviderProxy({
    required AIProviderStorageService providerService,
    required SecureStorageService secureStorage,
  }) : _providerService = providerService, _secureStorage = secureStorage {
    loadProviders();
  }
  
  /// 加载所有提供商
  Future<void> loadProviders() async {
    isLoading.value = true;
    try {
      final loadedProviders = await _providerService.getProviders();
      providers.value = loadedProviders;
      
      // 加载当前提供商
      final current = await _providerService.getCurrentProvider();
      currentProvider.value = current;
      if (current != null) {
        selectedProviderId.value = current.id;
      }
    } catch (e) {
      // 错误处理由调用方决定
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }
  
  /// 添加新提供商
  Future<void> addProvider({
    required String name,
    required String sourceType,
    String? apiKey,
    String? baseUrl,
  }) async {
    final now = DateTime.now().toUtc();
    final providerId = '${sourceType.toLowerCase()}-${now.millisecondsSinceEpoch}';
    
    final newProvider = Provider(
      id: providerId,
      name: name,
      peersUserId: 'default', // TODO: 获取当前用户ID
      sort: providers.value.length,
      enabled: true,
      sourceType: sourceType,
      settingsJson: jsonEncode({
        'baseUrl': baseUrl ?? _getDefaultBaseUrl(sourceType),
        'models': _getDefaultModels(sourceType),
      }),
      configJson: jsonEncode({
        'temperature': 0.7,
        'maxTokens': 2048,
      }),
      accessedAt: $0.Timestamp.fromDateTime(now),
      createdAt: $0.Timestamp.fromDateTime(now),
      updatedAt: $0.Timestamp.fromDateTime(now),
    );
    
    await _providerService.saveProvider(newProvider);
    
    // 保存API密钥到安全存储
    if (apiKey != null && apiKey.isNotEmpty) {
      await _saveApiKey(providerId, apiKey);
    }
    
    await loadProviders();
  }
  
  /// 更新提供商
  Future<void> updateProvider(Provider provider) async {
    final updatedProvider = Provider()
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
      ..settingsJson = provider.settingsJson
      ..configJson = provider.configJson
      ..accessedAt = provider.accessedAt
      ..createdAt = provider.createdAt
      ..updatedAt = Timestamp.fromDateTime(DateTime.now().toUtc());
    
    await _providerService.saveProvider(updatedProvider);
    await loadProviders();
  }
  
  /// 删除提供商
  Future<void> deleteProvider(String providerId) async {
    await _providerService.deleteProvider(providerId, 'default');
    await _deleteApiKey(providerId);
    await loadProviders();
  }
  
  /// 设置当前提供商
  Future<void> setCurrentProvider(String providerId) async {
    await _providerService.setCurrentProvider(providerId);
    selectedProviderId.value = providerId;
    
    // 重新加载当前提供商
    final current = await _providerService.getCurrentProvider();
    currentProvider.value = current;
  }
  
  /// 测试提供商连接
  Future<bool> testProviderConnection(String providerId) async {
    try {
      final provider = providers.value.firstWhere((p) => p.id == providerId);
      final apiKey = await _getApiKey(providerId);
      
      if (apiKey == null || apiKey.isEmpty) {
        throw Exception('请先设置API密钥');
      }
      
      // 创建临时提供商用于测试
      final testProvider = Provider()
        ..id = provider.id
        ..name = provider.name
        ..peersUserId = provider.peersUserId
        ..sort = provider.sort
        ..enabled = provider.enabled
        ..checkModel = provider.checkModel
        ..logo = provider.logo
        ..description = provider.description
        ..keyVaults = apiKey
        ..sourceType = provider.sourceType
        ..settingsJson = provider.settingsJson
        ..configJson = provider.configJson
        ..accessedAt = provider.accessedAt
        ..createdAt = provider.createdAt
        ..updatedAt = provider.updatedAt;
      
      return await _providerService.testProviderConnection(testProvider);
    } catch (e) {
      rethrow;
    }
  }
  
  /// 获取提供商的模型列表
  Future<List<String>> fetchProviderModels(String providerId) async {
    try {
      final provider = providers.value.firstWhere((p) => p.id == providerId);
      final apiKey = await _getApiKey(providerId);
      
      if (apiKey == null || apiKey.isEmpty) {
        return [];
      }
      
      // 创建临时提供商用于获取模型
      final testProvider = Provider()
        ..id = provider.id
        ..name = provider.name
        ..peersUserId = provider.peersUserId
        ..sort = provider.sort
        ..enabled = provider.enabled
        ..checkModel = provider.checkModel
        ..logo = provider.logo
        ..description = provider.description
        ..keyVaults = apiKey
        ..sourceType = provider.sourceType
        ..settingsJson = provider.settingsJson
        ..configJson = provider.configJson
        ..accessedAt = provider.accessedAt
        ..createdAt = provider.createdAt
        ..updatedAt = provider.updatedAt;
      
      return await _providerService.fetchProviderModels(testProvider);
    } catch (e) {
      return [];
    }
  }
  
  /// 保存API密钥
  Future<void> _saveApiKey(String providerId, String apiKey) async {
    await _secureStorage.set('provider_key_$providerId', apiKey);
  }
  
  /// 获取API密钥
  Future<String?> _getApiKey(String providerId) async {
    return await _secureStorage.get('provider_key_$providerId');
  }
  
  /// 公开获取API密钥的方法
  Future<String?> getApiKey(String providerId) async {
    return await _getApiKey(providerId);
  }
  
  /// 删除API密钥
  Future<void> _deleteApiKey(String providerId) async {
    await _secureStorage.remove('provider_key_$providerId');
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
  
  /// 清理资源
  void dispose() {
    providers.dispose();
    currentProvider.dispose();
    isLoading.dispose();
    selectedProviderId.dispose();
  }
}